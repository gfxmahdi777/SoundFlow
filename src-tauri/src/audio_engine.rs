use crate::com_policy::PolicyConfigClient;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use windows::core::{Interface, PCWSTR, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired,
    AudioSessionStateInactive, IAudioSessionControl, IAudioSessionControl2,
    IAudioSessionManager2, IMMDevice, IMMDeviceCollection, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::ProcessStatus::EnumProcesses;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMeterUpdatePayload {
    pub session_peaks: HashMap<u32, f32>,
    pub device_peaks: HashMap<String, f32>,
    pub device_volumes: HashMap<String, f32>,
    pub device_mutes: HashMap<String, bool>,
    pub session_volumes: HashMap<u32, f32>,
    pub session_mutes: HashMap<u32, bool>,
}

/// Samples real-time peak audio values (`0.0` to `1.0`), master volume scalars (`0.0` to `1.0`),
/// and mute states for all physical output devices and active application audio sessions.
pub fn sample_audio_meters_snapshot() -> AudioMeterUpdatePayload {
    ensure_com_initialized();
    let mut session_peaks: HashMap<u32, f32> = HashMap::new();
    let mut device_peaks: HashMap<String, f32> = HashMap::new();
    let mut device_volumes: HashMap<String, f32> = HashMap::new();
    let mut device_mutes: HashMap<String, bool> = HashMap::new();
    let mut session_volumes: HashMap<u32, f32> = HashMap::new();
    let mut session_mutes: HashMap<u32, bool> = HashMap::new();

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(_) => {
                    return AudioMeterUpdatePayload {
                        session_peaks,
                        device_peaks,
                        device_volumes,
                        device_mutes,
                        session_volumes,
                        session_mutes,
                    };
                }
            };

        let collection: IMMDeviceCollection =
            match enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
                Ok(c) => c,
                Err(_) => {
                    return AudioMeterUpdatePayload {
                        session_peaks,
                        device_peaks,
                        device_volumes,
                        device_mutes,
                        session_volumes,
                        session_mutes,
                    };
                }
            };

        let count = collection.GetCount().unwrap_or(0);
        for idx in 0..count {
            if let Ok(device) = collection.Item(idx) {
                let device_id = device
                    .GetId()
                    .ok()
                    .and_then(|pwstr| pwstr_to_string_and_free(pwstr))
                    .unwrap_or_default();

                if !device_id.is_empty() {
                    // 1a. Physical Device Peak Meter via IMMDevice::Activate::<IAudioMeterInformation>
                    if let Ok(dev_meter) =
                        device.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)
                    {
                        if let Ok(peak) = dev_meter.GetPeakValue() {
                            let clamped = if peak.is_finite() {
                                peak.clamp(0.0, 1.0)
                            } else {
                                0.0
                            };
                            device_peaks.insert(device_id.clone(), clamped);
                        }
                    }

                    // 1b. Two-Way Physical Device Master Volume & Mute via IAudioEndpointVolume
                    if let Ok(endpoint_vol) =
                        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                    {
                        if let Ok(vol_scalar) = endpoint_vol.GetMasterVolumeLevelScalar() {
                            let clamped = if vol_scalar.is_finite() {
                                vol_scalar.clamp(0.0, 1.0)
                            } else {
                                1.0
                            };
                            device_volumes.insert(device_id.clone(), clamped);
                        }
                        if let Ok(muted) = endpoint_vol.GetMute() {
                            device_mutes.insert(device_id.clone(), muted.as_bool());
                        }
                    }
                }

                // 2. Per-Application Session Peak Meter & Volume/Mute via IAudioSessionControl
                if let Ok(manager2) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                    if let Ok(session_enum) = manager2.GetSessionEnumerator() {
                        let session_count = session_enum.GetCount().unwrap_or(0);
                        for s_idx in 0..session_count {
                            if let Ok(control) = session_enum.GetSession(s_idx) {
                                // Include Active & Inactive sessions (skip Expired) so volume/mute
                                // stays synced even when paused, while only metering active peaks.
                                let state_val = match control.GetState() {
                                    Ok(st) => st.0,
                                    Err(_) => continue,
                                };
                                if state_val == AudioSessionStateExpired.0 {
                                    continue;
                                }
                                let is_active = state_val == AudioSessionStateActive.0;

                                if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                                    let pid = control2.GetProcessId().unwrap_or(0);
                                    if pid == 0 || pid == 4 || control2.IsSystemSoundsSession().0 == 0 {
                                        continue;
                                    }

                                    if is_active {
                                        if let Ok(meter) = control.cast::<IAudioMeterInformation>() {
                                            if let Ok(peak) = meter.GetPeakValue() {
                                                let clamped = if peak.is_finite() {
                                                    peak.clamp(0.0, 1.0)
                                                } else {
                                                    0.0
                                                };
                                                let entry = session_peaks.entry(pid).or_insert(0.0);
                                                if clamped > *entry {
                                                    *entry = clamped;
                                                }
                                            }
                                        }
                                    }

                                    if let Ok(simple_vol) = control.cast::<ISimpleAudioVolume>() {
                                        if let Ok(vol_scalar) = simple_vol.GetMasterVolume() {
                                            let clamped = if vol_scalar.is_finite() {
                                                vol_scalar.clamp(0.0, 1.0)
                                            } else {
                                                1.0
                                            };
                                            if is_active || !session_volumes.contains_key(&pid) {
                                                session_volumes.insert(pid, clamped);
                                            }
                                        }
                                        if let Ok(muted) = simple_vol.GetMute() {
                                            if is_active || !session_mutes.contains_key(&pid) {
                                                session_mutes.insert(pid, muted.as_bool());
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
    }

    AudioMeterUpdatePayload {
        session_peaks,
        device_peaks,
        device_volumes,
        device_mutes,
        session_volumes,
        session_mutes,
    }
}

pub struct CoreAudioEngine {
    pub app_device_assignments: HashMap<u32, String>,
    pub app_exe_assignments: HashMap<String, String>,
}

impl CoreAudioEngine {
    /// Creates the engine state without touching COM on the main UI startup thread,
    /// allowing Tauri/WebView2 to initialize its STA thread cleanly on launch.
    pub fn new() -> Self {
        Self {
            app_device_assignments: HashMap::new(),
            app_exe_assignments: HashMap::new(),
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

                    let mut master_volume: u32 = 100;
                    let mut muted: bool = false;
                    if let Ok(endpoint_vol) =
                        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
                    {
                        if let Ok(vol_scalar) = endpoint_vol.GetMasterVolumeLevelScalar() {
                            master_volume = (vol_scalar.clamp(0.0, 1.0) * 100.0).round() as u32;
                        }
                        if let Ok(m) = endpoint_vol.GetMute() {
                            muted = m.as_bool();
                        }
                    }

                    result.push(AudioOutputDeviceDto {
                        is_default: !default_id.is_empty() && id == default_id,
                        id,
                        name: friendly_name,
                        driver: driver_name,
                        status: "connected".to_string(),
                        form_factor: form_factor.to_string(),
                        sample_rate: "48.0 kHz".to_string(),
                        bit_depth: "24-bit".to_string(),
                        master_volume,
                        muted,
                    });
                }
            }

            Ok(result)
        }
    }

    /// Enumerates BOTH Active (`AudioSessionStateActive`) and Inactive (`AudioSessionStateInactive`)
    /// WASAPI audio sessions (filtering out only `AudioSessionStateExpired` and system idle PID 0/4),
    /// AND proactively scans running desktop media/browser/creative processes so newly launched apps
    /// (Chrome, Brave, Edge, VLC, Premiere Pro, After Effects, etc.) appear immediately before audio plays.
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
            let current_pid = std::process::id();
            // Deduplicate by lowercase executable name so multi-process apps (Chrome/Brave/Edge)
            // appear as a single clean entry and Active streams always override stale Inactive ones.
            let mut sessions_by_exe: HashMap<String, AppAudioSessionDto> = HashMap::new();

            // 1. Enumerate WASAPI audio sessions (both Active & Inactive; skip Expired & System Sounds)
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
                                    let state_val = match control.GetState() {
                                        Ok(st) => st.0,
                                        Err(_) => continue,
                                    };
                                    // Include BOTH AudioSessionStateActive (1) and AudioSessionStateInactive (0);
                                    // filter out AudioSessionStateExpired (2).
                                    let is_active = state_val == AudioSessionStateActive.0;
                                    let is_inactive = state_val == AudioSessionStateInactive.0;
                                    if state_val == AudioSessionStateExpired.0
                                        || (!is_active && !is_inactive)
                                    {
                                        continue;
                                    }

                                    if let Ok(control2) = control.cast::<IAudioSessionControl2>() {
                                        let pid = control2.GetProcessId().unwrap_or(0);
                                        // Skip System Idle (0), System (4), SoundFlow itself, and System Sounds
                                        if pid == 0
                                            || pid == 4
                                            || pid == current_pid
                                            || control2.IsSystemSoundsSession().0 == 0
                                        {
                                            continue;
                                        }

                                        let (full_path, exe_name) = resolve_process_paths(pid);
                                        let friendly_app_name = resolve_clean_app_name(
                                            &control,
                                            full_path.as_deref(),
                                            exe_name.as_deref(),
                                        );
                                        let clean_exe = exe_name.unwrap_or_else(|| {
                                            format!("{}.exe", friendly_app_name.replace(' ', ""))
                                        });
                                        let exe_key = clean_exe.to_lowercase();

                                        if exe_key == "soundflow.exe" || exe_key == "audiodg.exe" {
                                            continue;
                                        }

                                        let icon_type =
                                            infer_icon_type(&clean_exe, &friendly_app_name);

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
                                            .or_else(|| self.app_exe_assignments.get(&exe_key))
                                            .cloned()
                                            .unwrap_or_else(|| device_id.clone());

                                        let candidate = AppAudioSessionDto {
                                            id: format!("app-{pid}"),
                                            pid,
                                            name: friendly_app_name.clone(),
                                            window_title: friendly_app_name,
                                            executable: clean_exe,
                                            icon_type,
                                            assigned_device_id: assigned.clone(),
                                            preferred_device_id: assigned,
                                            volume: (raw_vol.clamp(0.0, 1.0) * 100.0).round()
                                                as u32,
                                            muted,
                                            is_playing: is_active,
                                        };

                                        // Prefer Active sessions over Inactive sessions when an app
                                        // has a stale inactive session left on an old device.
                                        let should_replace = match sessions_by_exe.get(&exe_key) {
                                            None => true,
                                            Some(existing) => {
                                                (!existing.is_playing && candidate.is_playing)
                                                    || (existing.is_playing == candidate.is_playing
                                                        && self
                                                            .app_exe_assignments
                                                            .get(&exe_key)
                                                            .map(|d| d == &device_id)
                                                            .unwrap_or(false))
                                            }
                                        };

                                        if should_replace {
                                            sessions_by_exe.insert(exe_key, candidate);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 2. Proactively scan running desktop media/browser/creative processes so they
            // appear immediately upon launch even before any audio stream begins playing.
            for pid in enumerate_running_pids() {
                if pid == 0 || pid == 4 || pid == current_pid {
                    continue;
                }
                let (full_path, exe_opt) = resolve_process_paths(pid);
                let Some(exe_name) = exe_opt else {
                    continue;
                };
                let exe_key = exe_name.to_lowercase();
                if sessions_by_exe.contains_key(&exe_key) || !is_known_desktop_media_app(&exe_key) {
                    continue;
                }

                let friendly_app_name = full_path
                    .as_deref()
                    .and_then(extract_exe_file_description)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| {
                        let stem = capitalize_executable_stem(&exe_name);
                        if stem.is_empty() {
                            "Unknown App".to_string()
                        } else {
                            stem
                        }
                    });

                let icon_type = infer_icon_type(&exe_name, &friendly_app_name);
                let assigned = self
                    .app_device_assignments
                    .get(&pid)
                    .or_else(|| self.app_exe_assignments.get(&exe_key))
                    .cloned()
                    .unwrap_or_else(|| "default".to_string());

                sessions_by_exe.insert(
                    exe_key,
                    AppAudioSessionDto {
                        id: format!("app-{pid}"),
                        pid,
                        name: friendly_app_name.clone(),
                        window_title: friendly_app_name,
                        executable: exe_name,
                        icon_type,
                        assigned_device_id: assigned.clone(),
                        preferred_device_id: assigned,
                        volume: 100,
                        muted: false,
                        is_playing: false,
                    },
                );
            }

            let mut list: Vec<AppAudioSessionDto> = sessions_by_exe.into_values().collect();
            list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            Ok(list)
        }
    }

    /// Routes an application (by PID and all sibling processes of the same executable) to a specific
    /// audio output device across BOTH `eMultimedia` and `eConsole` roles via `IAudioPolicyConfig`.
    pub fn set_app_audio_device(&mut self, pid: u32, device_id: String) -> Result<(), String> {
        ensure_com_initialized();

        let (_full_path, exe_opt) = resolve_process_paths(pid);
        let exe_key = exe_opt.as_deref().map(|s| s.to_lowercase());

        // Collect the primary PID plus all sibling PIDs sharing the same executable (crucial for
        // multi-process browsers like Chrome/Brave/Edge and creative suites like Premiere Pro).
        let mut target_pids: Vec<u32> = vec![pid];
        if let Some(ref key) = exe_key {
            for sibling_pid in find_pids_by_executable(key) {
                if !target_pids.contains(&sibling_pid) {
                    target_pids.push(sibling_pid);
                }
            }
        }

        if let Ok(policy) = PolicyConfigClient::new() {
            let _ = policy.set_app_endpoints(&target_pids, &device_id);
        }

        let trimmed = device_id.trim();
        let is_reset = trimmed.is_empty() || trimmed == "default" || trimmed == "unassigned";
        if is_reset {
            for &p in &target_pids {
                self.app_device_assignments.remove(&p);
            }
            if let Some(ref key) = exe_key {
                self.app_exe_assignments.remove(key);
            }
        } else {
            for &p in &target_pids {
                self.app_device_assignments.insert(p, device_id.clone());
            }
            if let Some(key) = exe_key {
                self.app_exe_assignments.insert(key, device_id);
            }
        }
        Ok(())
    }

    /// Sets per-application volume (`0.0` to `1.0` or `0.0` to `100.0`) via `ISimpleAudioVolume`.
    /// Matches both the given PID and sibling PIDs of the same executable for multi-process apps.
    pub fn set_app_volume(&self, pid: u32, volume: f32) -> Result<(), String> {
        ensure_com_initialized();
        let normalized = if volume > 1.0 {
            (volume / 100.0).clamp(0.0, 1.0)
        } else {
            volume.clamp(0.0, 1.0)
        };

        let target_pids = collect_app_pid_set(pid);

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
                                        let session_pid = control2.GetProcessId().unwrap_or(0);
                                        if target_pids.contains(&session_pid) {
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
    /// Matches both the given PID and sibling PIDs of the same executable for multi-process apps.
    pub fn set_app_mute(&self, pid: u32, muted: bool) -> Result<(), String> {
        ensure_com_initialized();
        let target_pids = collect_app_pid_set(pid);

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
                                        let session_pid = control2.GetProcessId().unwrap_or(0);
                                        if target_pids.contains(&session_pid) {
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

    /// Sets master volume (`0.0` to `1.0` or `0.0` to `100.0`) for a physical audio endpoint via `IAudioEndpointVolume`.
    pub fn set_device_volume(&self, device_id: String, volume: f32) -> Result<(), String> {
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
                    Err(err) => return Err(format!("MMDeviceEnumerator failed: {err}")),
                };

            let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
            let pcwstr = PCWSTR(wide.as_ptr());
            let device = match enumerator.GetDevice(pcwstr) {
                Ok(dev) => dev,
                Err(_) => {
                    let collection = enumerator
                        .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                        .map_err(|e| format!("EnumAudioEndpoints failed: {e}"))?;
                    let count = collection.GetCount().unwrap_or(0);
                    let mut found: Option<IMMDevice> = None;
                    for idx in 0..count {
                        if let Ok(dev) = collection.Item(idx) {
                            if let Ok(id_pwstr) = dev.GetId() {
                                if let Some(id_str) = pwstr_to_string_and_free(id_pwstr) {
                                    if id_str == device_id {
                                        found = Some(dev);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    found.ok_or_else(|| format!("Device not found: {device_id}"))?
                }
            };

            let endpoint_vol: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioEndpointVolume failed: {e}"))?;

            endpoint_vol
                .SetMasterVolumeLevelScalar(normalized, std::ptr::null())
                .map_err(|e| format!("SetMasterVolumeLevelScalar failed: {e}"))?;
        }
        Ok(())
    }

    /// Mutes or unmutes a physical audio endpoint via `IAudioEndpointVolume::SetMute`.
    pub fn set_device_mute(&self, device_id: String, muted: bool) -> Result<(), String> {
        ensure_com_initialized();
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                    Ok(e) => e,
                    Err(err) => return Err(format!("MMDeviceEnumerator failed: {err}")),
                };

            let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
            let pcwstr = PCWSTR(wide.as_ptr());
            let device = match enumerator.GetDevice(pcwstr) {
                Ok(dev) => dev,
                Err(_) => {
                    let collection = enumerator
                        .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                        .map_err(|e| format!("EnumAudioEndpoints failed: {e}"))?;
                    let count = collection.GetCount().unwrap_or(0);
                    let mut found: Option<IMMDevice> = None;
                    for idx in 0..count {
                        if let Ok(dev) = collection.Item(idx) {
                            if let Ok(id_pwstr) = dev.GetId() {
                                if let Some(id_str) = pwstr_to_string_and_free(id_pwstr) {
                                    if id_str == device_id {
                                        found = Some(dev);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    found.ok_or_else(|| format!("Device not found: {device_id}"))?
                }
            };

            let endpoint_vol: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Activate IAudioEndpointVolume failed: {e}"))?;

            endpoint_vol
                .SetMute(muted, std::ptr::null())
                .map_err(|e| format!("SetMute failed: {e}"))?;
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

/// Opens the target process by PID and returns `(Option<full_exe_path>, Option<exe_filename>)`.
fn resolve_process_paths(pid: u32) -> (Option<String>, Option<String>) {
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            let mut buffer = [0u16; 1024];
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
                let full_path =
                    String::from_utf16_lossy(&buffer[..size as usize]).trim().to_string();
                if !full_path.is_empty() {
                    let file_name = full_path
                        .rsplit('\\')
                        .next()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    return (Some(full_path), file_name);
                }
            }
        }
    }
    (None, None)
}

#[repr(C)]
#[derive(Copy, Clone)]
struct LangAndCodePage {
    language: u16,
    code_page: u16,
}

/// Uses the Windows FileVersion API (`GetFileVersionInfoW` + `VerQueryValueW`) to extract
/// the user-friendly `"FileDescription"` (or `"ProductName"`) embedded in the executable.
fn extract_exe_file_description(full_exe_path: &str) -> Option<String> {
    unsafe {
        let wide_path: Vec<u16> = full_exe_path
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let pcwstr = PCWSTR(wide_path.as_ptr());

        let info_size = GetFileVersionInfoSizeW(pcwstr, None);
        if info_size == 0 || info_size > 4 * 1024 * 1024 {
            return None;
        }

        let mut data = vec![0u8; info_size as usize];
        if GetFileVersionInfoW(pcwstr, 0, info_size, data.as_mut_ptr() as *mut c_void).is_err() {
            return None;
        }

        let mut lang_pairs: Vec<(u16, u16)> = Vec::new();
        let trans_query: Vec<u16> = "\\VarFileInfo\\Translation"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut trans_ptr: *mut c_void = std::ptr::null_mut();
        let mut trans_len: u32 = 0;

        if VerQueryValueW(
            data.as_ptr() as *const c_void,
            PCWSTR(trans_query.as_ptr()),
            &mut trans_ptr,
            &mut trans_len,
        )
        .as_bool()
            && !trans_ptr.is_null()
            && trans_len >= std::mem::size_of::<LangAndCodePage>() as u32
        {
            let count = (trans_len as usize) / std::mem::size_of::<LangAndCodePage>();
            let slice = std::slice::from_raw_parts(trans_ptr as *const LangAndCodePage, count);
            for item in slice {
                lang_pairs.push((item.language, item.code_page));
            }
        }

        // Standard fallback language/codepage pairs (US English Unicode & Multilingual)
        for fallback in [(0x0409u16, 0x04B0u16), (0x0409u16, 0x04E4u16), (0x0000u16, 0x04B0u16)] {
            if !lang_pairs.contains(&fallback) {
                lang_pairs.push(fallback);
            }
        }

        for (lang, cp) in lang_pairs {
            for field in ["FileDescription", "ProductName"] {
                let subblock = format!("\\StringFileInfo\\{lang:04x}{cp:04x}\\{field}");
                let subblock_wide: Vec<u16> =
                    subblock.encode_utf16().chain(std::iter::once(0)).collect();
                let mut val_ptr: *mut c_void = std::ptr::null_mut();
                let mut val_len: u32 = 0;

                if VerQueryValueW(
                    data.as_ptr() as *const c_void,
                    PCWSTR(subblock_wide.as_ptr()),
                    &mut val_ptr,
                    &mut val_len,
                )
                .as_bool()
                    && !val_ptr.is_null()
                    && val_len > 0
                {
                    let u16_ptr = val_ptr as *const u16;
                    let max_chars = (val_len as usize).min(256);
                    let mut actual_len = 0usize;
                    while actual_len < max_chars && *u16_ptr.add(actual_len) != 0 {
                        actual_len += 1;
                    }
                    if actual_len > 0 {
                        let raw_str = String::from_utf16_lossy(std::slice::from_raw_parts(
                            u16_ptr, actual_len,
                        ));
                        let cleaned = clean_version_description(raw_str.trim());
                        if !cleaned.is_empty() {
                            return Some(cleaned);
                        }
                    }
                }
            }
        }
    }
    None
}

fn clean_version_description(desc: &str) -> String {
    let trimmed = desc
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .trim();
    if trimmed.eq_ignore_ascii_case("Windows Host Process (Rundll32)")
        || trimmed.starts_with('@')
    {
        return String::new();
    }
    trimmed.to_string()
}

/// Resolves the cleanest human-readable application name using:
/// 1. Win32 `VerQueryValueW` `FileDescription` / `ProductName` from the full executable path
/// 2. Audio session `GetDisplayName()` (if it is a clean title rather than a `@%SystemRoot%` resource string)
/// 3. Curated application title lookup & capitalized executable stem without `.exe`
unsafe fn resolve_clean_app_name(
    control: &IAudioSessionControl,
    full_path: Option<&str>,
    exe_name: Option<&str>,
) -> String {
    // 1. Try Win32 FileVersionInfo FileDescription / ProductName
    if let Some(path) = full_path {
        if let Some(desc) = extract_exe_file_description(path) {
            if !desc.is_empty() {
                return desc;
            }
        }
    }

    // 2. Try WASAPI Session Display Name if present and not a DLL resource path
    if let Ok(display_pwstr) = control.GetDisplayName() {
        if let Some(display_str) = pwstr_to_string_and_free(display_pwstr) {
            let trimmed = display_str.trim();
            if !trimmed.is_empty()
                && !trimmed.starts_with('@')
                && !trimmed.contains('\\')
                && !trimmed.to_lowercase().starts_with("process_")
            {
                return trimmed.to_string();
            }
        }
    }

    // 3. Fallback to capitalized executable name without .exe
    if let Some(exe) = exe_name {
        let friendly = capitalize_executable_stem(exe);
        if !friendly.is_empty() {
            return friendly;
        }
    }

    "Unknown App".to_string()
}

fn capitalize_executable_stem(exe: &str) -> String {
    let stem = exe
        .trim()
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .trim();
    if stem.is_empty() || stem.to_lowercase().starts_with("process_") {
        return String::new();
    }

    let lower = stem.to_lowercase();
    match lower.as_str() {
        "brave" => return "Brave Browser".to_string(),
        "chrome" => return "Google Chrome".to_string(),
        "msedge" | "msedgewebview2" => return "Microsoft Edge".to_string(),
        "firefox" => return "Mozilla Firefox".to_string(),
        "opera" => return "Opera Browser".to_string(),
        "vivaldi" => return "Vivaldi".to_string(),
        "spotify" => return "Spotify".to_string(),
        "discord" => return "Discord".to_string(),
        "vlc" => return "VLC Media Player".to_string(),
        "obs64" | "obs32" | "obs" => return "OBS Studio".to_string(),
        "afterfx" => return "Adobe After Effects".to_string(),
        "adobe premiere pro" | "premiere" => return "Adobe Premiere Pro".to_string(),
        "steam" | "steamwebhelper" => return "Steam".to_string(),
        "wmplayer" => return "Windows Media Player".to_string(),
        "music.ui" => return "Media Player".to_string(),
        "audiodg" => return "Windows Audio Device Graph".to_string(),
        _ => {}
    }

    // Replace underscores/hyphens with spaces and capitalize each word
    stem.split(|c: char| c == '_' || c == '-' || c == ' ')
        .filter(|part| !part.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn infer_icon_type(exe: &str, friendly_name: &str) -> String {
    let combined = format!("{} {}", exe.to_lowercase(), friendly_name.to_lowercase());
    if combined.contains("chrome")
        || combined.contains("brave")
        || combined.contains("edge")
        || combined.contains("firefox")
        || combined.contains("opera")
        || combined.contains("browser")
    {
        "chrome".to_string()
    } else if combined.contains("afterfx")
        || combined.contains("after effects")
        || combined.contains("premiere")
    {
        "after-effects".to_string()
    } else if combined.contains("vlc") || combined.contains("media player") {
        "vlc".to_string()
    } else if combined.contains("spotify") || combined.contains("music") {
        "spotify".to_string()
    } else if combined.contains("discord") || combined.contains("teams") || combined.contains("zoom")
    {
        "discord".to_string()
    } else if combined.contains("obs") {
        "obs".to_string()
    } else {
        "game".to_string()
    }
}

/// Enumerates all running Windows process IDs safely via `EnumProcesses` (psapi).
fn enumerate_running_pids() -> Vec<u32> {
    unsafe {
        let mut pids = vec![0u32; 2048];
        let mut bytes_returned: u32 = 0;
        let ok = EnumProcesses(
            pids.as_mut_ptr(),
            (pids.len() * std::mem::size_of::<u32>()) as u32,
            &mut bytes_returned,
        )
        .is_ok();
        if !ok || bytes_returned == 0 {
            return Vec::new();
        }
        let count = (bytes_returned as usize / std::mem::size_of::<u32>()).min(pids.len());
        pids.truncate(count);
        pids
    }
}

/// Finds all currently running PIDs whose executable filename matches `target_exe_lower`.
fn find_pids_by_executable(target_exe_lower: &str) -> Vec<u32> {
    let mut matches = Vec::new();
    for pid in enumerate_running_pids() {
        if pid == 0 || pid == 4 {
            continue;
        }
        let (_path, exe_opt) = resolve_process_paths(pid);
        if let Some(exe) = exe_opt {
            if exe.to_lowercase() == target_exe_lower {
                matches.push(pid);
            }
        }
    }
    matches
}

/// Collects a `HashSet` containing `pid` plus any sibling PIDs sharing the same executable image.
fn collect_app_pid_set(pid: u32) -> HashSet<u32> {
    let mut set = HashSet::new();
    set.insert(pid);
    let (_path, exe_opt) = resolve_process_paths(pid);
    if let Some(exe) = exe_opt {
        let lower = exe.to_lowercase();
        for sibling in find_pids_by_executable(&lower) {
            set.insert(sibling);
        }
    }
    set
}

/// Returns true for well-known desktop media, browser, creative, communication, and streaming
/// executables so they appear immediately in Application Routing upon launch even before audio plays.
fn is_known_desktop_media_app(exe_lower: &str) -> bool {
    matches!(
        exe_lower,
        "chrome.exe"
            | "brave.exe"
            | "msedge.exe"
            | "firefox.exe"
            | "opera.exe"
            | "opera_gx.exe"
            | "vivaldi.exe"
            | "arc.exe"
            | "waterfox.exe"
            | "zen.exe"
            | "vlc.exe"
            | "spotify.exe"
            | "itunes.exe"
            | "applemusic.exe"
            | "tidal.exe"
            | "foobar2000.exe"
            | "mpc-hc64.exe"
            | "mpc-hc.exe"
            | "mpc-be64.exe"
            | "potplayermini64.exe"
            | "potplayer64.exe"
            | "wmplayer.exe"
            | "music.ui.exe"
            | "winamp.exe"
            | "aimp.exe"
            | "mpv.exe"
            | "adobe premiere pro.exe"
            | "afterfx.exe"
            | "adobe audition.exe"
            | "resolve.exe"
            | "davinciresolve.exe"
            | "obs64.exe"
            | "obs32.exe"
            | "streamlabs obs.exe"
            | "fl64.exe"
            | "audacity.exe"
            | "capcut.exe"
            | "discord.exe"
            | "teams.exe"
            | "ms-teams.exe"
            | "zoom.exe"
            | "slack.exe"
            | "telegram.exe"
            | "whatsapp.exe"
            | "steam.exe"
    ) || exe_lower.starts_with("ableton live")
        || exe_lower.starts_with("vegas")
}

