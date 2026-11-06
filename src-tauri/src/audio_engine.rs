use crate::com_policy::PolicyConfigClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::c_void;
use windows::core::{Interface, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDevice,
    IMMDeviceCollection, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PROPERTYKEY};

/// PKEY_Device_FriendlyName: {a45c254e-df1c-4efd-8020-67d146a850e0}, 14
const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

/// PKEY_Device_DeviceDesc: {a45c254e-df1c-4efd-8020-67d146a850e0}, 2
const PKEY_DEVICE_DESC: PROPERTYKEY = PROPERTYKEY {
    fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 2,
};

/// Safely initializes COM on the current worker/IPC thread without panicking
/// if the thread is already initialized in STA or MTA mode.
pub fn ensure_com_initialized() {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
        if hr.is_err() {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
    }
}

/// Safely reads a null-terminated UTF-16 string from a COM-allocated `PWSTR`
/// and frees the underlying COM task memory. Never dereferences a null pointer.
unsafe fn pwstr_to_string_and_free(ptr: PWSTR) -> Option<String> {
    if ptr.is_null() || ptr.0.is_null() {
        return None;
    }
    let raw = ptr.0;
    let mut len = 0usize;
    while len < 4096 && *raw.add(len) != 0 {
        len += 1;
    }
    let slice = std::slice::from_raw_parts(raw, len);
    let result = String::from_utf16_lossy(slice);
    CoTaskMemFree(Some(raw as *const c_void));
    Some(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDeviceDto {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub status: String,
    pub form_factor: String,
    pub is_default: bool,
    pub sample_rate: String,
    pub bit_depth: String,
    pub master_volume: u32,
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAudioSessionDto {
    pub id: String,
    pub pid: u32,
    pub executable: String,
    pub name: String,
    pub window_title: String,
    pub icon_type: String,
    pub assigned_device_id: String,
    pub preferred_device_id: String,
    pub volume: u32,
    pub muted: bool,
    pub is_playing: bool,
}

pub struct CoreAudioEngine {
    pub app_device_assignments: HashMap<u32, String>,
}

impl CoreAudioEngine {
    /// Creates the engine state without touching COM on the main UI startup thread,
    /// allowing Tauri/WebView2 to initialize its STA thread cleanly on launch.
    pub fn new() -> Self {
        Self {
            app_device_assignments: HashMap::new(),
        }
    }

    /// Enumerates physical playback audio devices via `IMMDeviceEnumerator`.
    pub fn get_audio_devices(&self) -> Result<Vec<AudioOutputDeviceDto>, String> {
        ensure_com_initialized();
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(err) => return Err(format!("MMDeviceEnumerator failed: {err}")),
                };

            let default_id = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .ok()
                .and_then(|dev| dev.GetId().ok())
                .and_then(|pwstr| pwstr_to_string_and_free(pwstr))
                .unwrap_or_default();

            let collection: IMMDeviceCollection = match enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            {
                Ok(c) => c,
                Err(err) => return Err(format!("EnumAudioEndpoints failed: {err}")),
            };

            let count = collection.GetCount().unwrap_or(0);
            let mut result = Vec::with_capacity(count as usize);

            for idx in 0..count {
                if let Ok(device) = collection.Item(idx) {
                    let id = device
                        .GetId()
                        .ok()
                        .and_then(|pwstr| pwstr_to_string_and_free(pwstr))
                        .unwrap_or_else(|| format!("dev-{idx}"));

                    let (friendly_name, driver_name) = read_device_names(&device, idx);
                    let lower = friendly_name.to_lowercase();
                    let form_factor = if lower.contains("headphone")
                        || lower.contains("headset")
                        || lower.contains("earphone")
                    {
                        "headphones"
                    } else if lower.contains("hdmi") || lower.contains("display") {
                        "monitor"
                    } else if lower.contains("dac") || lower.contains("focusrite") {
                        "dac"
                    } else {
                        "speakers"
                    };

                    result.push(AudioOutputDeviceDto {
                        is_default: !default_id.is_empty() && id == default_id,
                        id,
                        name: friendly_name,
                        driver: driver_name,
                        status: "connected".to_string(),
                        form_factor: form_factor.to_string(),
                        sample_rate: "48.0 kHz".to_string(),
                        bit_depth: "24-bit".to_string(),
                        master_volume: 100,
                        muted: false,
                    });
                }
            }

            Ok(result)
        }
    }

    /// Enumerates active audio sessions and running applications via `IAudioSessionManager2`.
    pub fn get_audio_sessions(&self) -> Result<Vec<AppAudioSessionDto>, String> {
        ensure_com_initialized();
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(err) => return Err(format!("MMDeviceEnumerator failed: {err}")),
                };

            let collection: IMMDeviceCollection = match enumerator
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            {
                Ok(c) => c,
                Err(err) => return Err(format!("EnumAudioEndpoints failed: {err}")),
            };

            let count = collection.GetCount().unwrap_or(0);
            let mut sessions_by_pid: HashMap<u32, AppAudioSessionDto> = HashMap::new();

            for idx in 0..count {
                if let Ok(device) = collection.Item(idx) {
                    let device_id = device
                        .GetId()
                        .ok()
                        .and_then(|pwstr| pwstr_to_string_and_free(pwstr))
                        .unwrap_or_default();

                    if let Ok(manager2) =
                        device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                    {
                        if let Ok(session_enum) = manager2.GetSessionEnumerator() {
                            let session_count = session_enum.GetCount().unwrap_or(0);
                            for s_idx in 0..session_count {
                                if let Ok(control) = session_enum.GetSession(s_idx) {
                                    if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                                        let pid = control2.GetProcessId().unwrap_or(0);
                                        if pid == 0 || sessions_by_pid.contains_key(&pid) {
                                            continue;
                                        }

                                        let executable = resolve_process_executable(pid);
                                        let friendly_app_name =
                                            friendly_name_from_exe(&executable);
                                        let icon_type = infer_icon_type(&executable);

                                        let simple_vol: Option<ISimpleAudioVolume> =
                                            control.cast().ok();
                                        let raw_vol = simple_vol
                                            .as_ref()
                                            .and_then(|v| v.GetMasterVolume().ok())
                                            .unwrap_or(1.0);
                                        let muted = simple_vol
                                            .as_ref()
                                            .and_then(|v| v.GetMute().ok())
                                            .map(|b| b.as_bool())
                                            .unwrap_or(false);

                                        let assigned = self
                                            .app_device_assignments
                                            .get(&pid)
                                            .cloned()
                                            .unwrap_or_else(|| device_id.clone());

                                        sessions_by_pid.insert(
                                            pid,
                                            AppAudioSessionDto {
                                                id: format!("app-{pid}"),
                                                pid,
                                                name: friendly_app_name.clone(),
                                                window_title: friendly_app_name,
                                                executable,
                                                icon_type,
                                                assigned_device_id: assigned.clone(),
                                                preferred_device_id: assigned,
                                                volume: (raw_vol.clamp(0.0, 1.0) * 100.0).round()
                                                    as u32,
                                                muted,
                                                is_playing: true,
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let mut list: Vec<AppAudioSessionDto> = sessions_by_pid.into_values().collect();
            list.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(list)
        }
    }

    /// Routes an application (by PID) to a specific audio output device using `IPolicyConfig` / `IAudioPolicyConfig`.
    pub fn set_app_audio_device(&mut self, pid: u32, device_id: String) -> Result<(), String> {
        ensure_com_initialized();
        if let Ok(policy) = PolicyConfigClient::new() {
            let _ = policy.set_app_endpoint(pid, &device_id);
        }
        self.app_device_assignments.insert(pid, device_id);
        Ok(())
    }

    /// Sets per-application volume (`0.0` to `1.0` or `0.0` to `100.0`) via `ISimpleAudioVolume`.
    pub fn set_app_volume(&self, pid: u32, volume: f32) -> Result<(), String> {
        ensure_com_initialized();
        let normalized = if volume > 1.0 {
            (volume / 100.0).clamp(0.0, 1.0)
        } else {
            volume.clamp(0.0, 1.0)
        };

        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(err) => return Err(err.to_string()),
                };
            let collection: IMMDeviceCollection =
                match enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                    Ok(c) => c,
                    Err(err) => return Err(err.to_string()),
                };

            let count = collection.GetCount().unwrap_or(0);
            for idx in 0..count {
                if let Ok(device) = collection.Item(idx) {
                    if let Ok(manager2) =
                        device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                    {
                        if let Ok(session_enum) = manager2.GetSessionEnumerator() {
                            let session_count = session_enum.GetCount().unwrap_or(0);
                            for s_idx in 0..session_count {
                                if let Ok(control) = session_enum.GetSession(s_idx) {
                                    if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                                        if control2.GetProcessId().unwrap_or(0) == pid {
                                            if let Ok(vol) = control.cast::<ISimpleAudioVolume>() {
                                                let _ = vol.SetMasterVolume(
                                                    normalized,
                                                    std::ptr::null(),
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Mutes or unmutes a specific application's audio session via `ISimpleAudioVolume::SetMute`.
    pub fn set_app_mute(&self, pid: u32, muted: bool) -> Result<(), String> {
        ensure_com_initialized();
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(err) => return Err(err.to_string()),
                };
            let collection: IMMDeviceCollection =
                match enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                    Ok(c) => c,
                    Err(err) => return Err(err.to_string()),
                };

            let count = collection.GetCount().unwrap_or(0);
            for idx in 0..count {
                if let Ok(device) = collection.Item(idx) {
                    if let Ok(manager2) =
                        device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                    {
                        if let Ok(session_enum) = manager2.GetSessionEnumerator() {
                            let session_count = session_enum.GetCount().unwrap_or(0);
                            for s_idx in 0..session_count {
                                if let Ok(control) = session_enum.GetSession(s_idx) {
                                    if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                                        if control2.GetProcessId().unwrap_or(0) == pid {
                                            if let Ok(vol) = control.cast::<ISimpleAudioVolume>() {
                                                let _ = vol.SetMute(muted, std::ptr::null());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn set_default_audio_device(&self, device_id: String) -> Result<(), String> {
        ensure_com_initialized();
        if let Ok(policy) = PolicyConfigClient::new() {
            let _ = policy.set_system_default_endpoint(&device_id);
        }
        Ok(())
    }
}

unsafe fn read_device_names(device: &IMMDevice, fallback_idx: u32) -> (String, String) {
    if let Ok(store) = device.OpenPropertyStore(STGM_READ) {
        let full_name = read_prop_string(&store, &PKEY_DEVICE_FRIENDLY_NAME)
            .unwrap_or_else(|| format!("Speaker ({})", fallback_idx + 1));
        let desc =
            read_prop_string(&store, &PKEY_DEVICE_DESC).unwrap_or_else(|| full_name.clone());

        if let Some((left, right)) = full_name.split_once(" (") {
            let driver = right.trim_end_matches(')').to_string();
            return (left.trim().to_string(), driver);
        }
        return (desc, full_name);
    }
    (
        format!("Audio Output {}", fallback_idx + 1),
        "Windows Core Audio".to_string(),
    )
}

unsafe fn read_prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
    let prop = store.GetValue(key).ok()?;
    let pwstr = PropVariantToStringAlloc(&prop).ok()?;
    pwstr_to_string_and_free(pwstr)
}

fn resolve_process_executable(pid: u32) -> String {
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buffer = [0u16; 512];
            let mut size = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(
                handle,
                PROCESS_NAME_WIN32,
                PWSTR(buffer.as_mut_ptr()),
                &mut size,
            )
            .is_ok();
            let _ = CloseHandle(handle);
            if ok && size > 0 && (size as usize) <= buffer.len() {
                let full_path = String::from_utf16_lossy(&buffer[..size as usize]);
                return full_path
                    .rsplit('\\')
                    .next()
                    .unwrap_or("Application.exe")
                    .to_string();
            }
        }
    }
    format!("process_{pid}.exe")
}

fn friendly_name_from_exe(exe: &str) -> String {
    let lower = exe.to_lowercase();
    if lower.contains("chrome") {
        "Google Chrome".to_string()
    } else if lower.contains("msedge") {
        "Microsoft Edge".to_string()
    } else if lower.contains("firefox") {
        "Mozilla Firefox".to_string()
    } else if lower.contains("afterfx") {
        "Adobe After Effects".to_string()
    } else if lower.contains("vlc") {
        "VLC Media Player".to_string()
    } else if lower.contains("spotify") {
        "Spotify".to_string()
    } else if lower.contains("discord") {
        "Discord".to_string()
    } else if lower.contains("obs") {
        "OBS Studio".to_string()
    } else {
        exe.trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string()
    }
}

fn infer_icon_type(exe: &str) -> String {
    let lower = exe.to_lowercase();
    if lower.contains("chrome") || lower.contains("msedge") || lower.contains("firefox") {
        "chrome".to_string()
    } else if lower.contains("afterfx") || lower.contains("premiere") {
        "after-effects".to_string()
    } else if lower.contains("vlc") {
        "vlc".to_string()
    } else if lower.contains("spotify") {
        "spotify".to_string()
    } else if lower.contains("discord") {
        "discord".to_string()
    } else if lower.contains("obs") {
        "obs".to_string()
    } else {
        "game".to_string()
    }
}
