#![allow(non_snake_case, non_camel_case_types)]

use crate::audio_engine::ensure_com_initialized;
use std::ffi::c_void;
use windows::core::{IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Media::Audio::{eConsole, eMultimedia, eRender, EDataFlow, ERole};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::WinRT::RoGetActivationFactory;

/// Windows 7/10/11 PolicyConfigClient CLSID for system default endpoint switching
pub const CLSID_POLICY_CONFIG_CLIENT: GUID =
    GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// IPolicyConfig IID (Windows 10 / 11): {f8679f50-850a-41cf-9c72-430f290290c8}
pub const IID_IPOLICY_CONFIG: GUID =
    GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

/// Windows 10 20H1+ & Windows 11 IAudioPolicyConfigFactory IID: {2a59116d-6c4f-45e0-a74f-707e3fef9258}
pub const IID_IAUDIO_POLICY_CONFIG_FACTORY_WIN11: GUID =
    GUID::from_u128(0x2a59116d_6c4f_45e0_a74f_707e3fef9258);

/// Windows 10 RS4 (1803-1909) IAudioPolicyConfigFactory IID: {ab3d4648-e242-459f-b02f-541c70306324}
pub const IID_IAUDIO_POLICY_CONFIG_FACTORY_WIN10: GUID =
    GUID::from_u128(0xab3d4648_e242_459f_b02f_541c70306324);

#[repr(C)]
pub struct IPolicyConfig_Vtbl {
    pub base__: IUnknown_Vtbl,
    pub GetMixFormat: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut *mut c_void) -> HRESULT,
    pub GetDeviceFormat:
        unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *mut *mut c_void) -> HRESULT,
    pub ResetDeviceFormat: unsafe extern "system" fn(*mut c_void, PCWSTR) -> HRESULT,
    pub SetDeviceFormat:
        unsafe extern "system" fn(*mut c_void, PCWSTR, *const c_void, *const c_void) -> HRESULT,
    pub GetProcessingPeriod:
        unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *mut i64, *mut i64) -> HRESULT,
    pub SetProcessingPeriod: unsafe extern "system" fn(*mut c_void, PCWSTR, *const i64) -> HRESULT,
    pub GetShareMode: unsafe extern "system" fn(*mut c_void, PCWSTR, *mut c_void) -> HRESULT,
    pub SetShareMode: unsafe extern "system" fn(*mut c_void, PCWSTR, *const c_void) -> HRESULT,
    pub GetPropertyValue:
        unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *const c_void, *mut c_void) -> HRESULT,
    pub SetPropertyValue:
        unsafe extern "system" fn(*mut c_void, PCWSTR, i32, *const c_void, *const c_void) -> HRESULT,
    pub SetDefaultEndpoint: unsafe extern "system" fn(*mut c_void, PCWSTR, ERole) -> HRESULT,
    pub SetEndpointVisibility: unsafe extern "system" fn(*mut c_void, PCWSTR, i32) -> HRESULT,
}

#[repr(C)]
pub struct IAudioPolicyConfigFactory_Vtbl {
    pub base__: IUnknown_Vtbl,
    // IInspectable (3 slots) + 19 internal methods before SetPersistedDefaultAudioEndpoint = 22 slots
    pub padding: [*const c_void; 22],
    pub SetPersistedDefaultAudioEndpoint: unsafe extern "system" fn(
        *mut c_void,
        u32,
        EDataFlow,
        ERole,
        *mut c_void,
    ) -> HRESULT,
    pub GetPersistedDefaultAudioEndpoint: unsafe extern "system" fn(
        *mut c_void,
        u32,
        EDataFlow,
        ERole,
        *mut *mut c_void,
    ) -> HRESULT,
    pub ClearAllPersistedApplicationDefaultEndpoints:
        unsafe extern "system" fn(*mut c_void) -> HRESULT,
}

pub struct PolicyConfigClient;

impl PolicyConfigClient {
    pub fn new() -> Result<Self, String> {
        ensure_com_initialized();
        Ok(Self)
    }

    /// Formats a raw MMDevice ID (`{0.0.0.00000000}.{guid}`) into the WinRT DEVINTERFACE_AUDIO_RENDER
    /// string required by `IAudioPolicyConfig::SetPersistedDefaultAudioEndpoint`.
    fn format_mmdevice_to_devinterface(device_id: &str) -> HSTRING {
        let trimmed = device_id.trim();
        if trimmed.is_empty() || trimmed == "default" || trimmed == "unassigned" {
            return HSTRING::new();
        }
        if trimmed.starts_with(r"\\?\SWD#MMDEVAPI#") {
            return HSTRING::from(trimmed);
        }
        let formatted = format!(
            r"\\?\SWD#MMDEVAPI#{trimmed}#{{e6327cad-dcec-4949-ae8a-991e976a79d2}}"
        );
        HSTRING::from(formatted)
    }

    /// Routes one or more Windows process IDs (e.g. an app's main process and sibling audio helper
    /// processes) to a physical audio output device across BOTH `eMultimedia` and `eConsole` roles
    /// so Windows never falls back to the system default endpoint (e.g. Realtek HD Audio).
    /// Passing `"default"`, `"unassigned"`, or `""` clears the persisted override.
    pub fn set_app_endpoints(&self, pids: &[u32], device_id: &str) -> Result<(), String> {
        ensure_com_initialized();
        unsafe {
            let class_name = HSTRING::from("Windows.Media.Internal.AudioPolicyConfig");
            if let Ok(unknown) = RoGetActivationFactory::<IUnknown>(&class_name) {
                let mut raw_ptr: *mut c_void = std::ptr::null_mut();
                let queried = unknown
                    .query(&IID_IAUDIO_POLICY_CONFIG_FACTORY_WIN11, &mut raw_ptr)
                    .is_ok()
                    || unknown
                        .query(&IID_IAUDIO_POLICY_CONFIG_FACTORY_WIN10, &mut raw_ptr)
                        .is_ok();

                if queried && !raw_ptr.is_null() {
                    let vtbl = *(raw_ptr as *const *const IAudioPolicyConfigFactory_Vtbl);
                    if !vtbl.is_null() {
                        let target_hstring = Self::format_mmdevice_to_devinterface(device_id);
                        let raw_hstring: *mut c_void = std::mem::transmute_copy(&target_hstring);

                        for &pid in pids {
                            if pid == 0 || pid == 4 {
                                continue;
                            }
                            // Apply to BOTH eMultimedia AND eConsole roles so apps using either
                            // role (browsers, Premiere Pro, games, media players) do not fall back
                            // to the default Realtek endpoint when switching outputs.
                            let _ = ((*vtbl).SetPersistedDefaultAudioEndpoint)(
                                raw_ptr,
                                pid,
                                eRender,
                                eMultimedia,
                                raw_hstring,
                            );
                            let _ = ((*vtbl).SetPersistedDefaultAudioEndpoint)(
                                raw_ptr,
                                pid,
                                eRender,
                                eConsole,
                                raw_hstring,
                            );
                        }
                        let _ = ((*vtbl).base__.Release)(raw_ptr);
                    }
                }
            }
            Ok(())
        }
    }

    /// Routes a single Windows application PID across both `eMultimedia` and `eConsole` roles.
    #[allow(dead_code)]
    pub fn set_app_endpoint(&self, pid: u32, device_id: &str) -> Result<(), String> {
        self.set_app_endpoints(&[pid], device_id)
    }

    /// Sets the system-wide default playback audio endpoint across Console & Multimedia roles.
    pub fn set_system_default_endpoint(&self, device_id: &str) -> Result<(), String> {
        ensure_com_initialized();
        unsafe {
            if let Ok(unknown) =
                CoCreateInstance::<_, IUnknown>(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
            {
                let mut raw_ptr: *mut c_void = std::ptr::null_mut();
                if unknown.query(&IID_IPOLICY_CONFIG, &mut raw_ptr).is_ok() && !raw_ptr.is_null() {
                    let vtbl = *(raw_ptr as *const *const IPolicyConfig_Vtbl);
                    if !vtbl.is_null() {
                        let wide: Vec<u16> = device_id
                            .trim()
                            .encode_utf16()
                            .chain(std::iter::once(0))
                            .collect();
                        let pcwstr = PCWSTR(wide.as_ptr());
                        let _ = ((*vtbl).SetDefaultEndpoint)(raw_ptr, pcwstr, eConsole);
                        let _ = ((*vtbl).SetDefaultEndpoint)(raw_ptr, pcwstr, eMultimedia);
                        let _ = ((*vtbl).base__.Release)(raw_ptr);
                    }
                }
            }
            Ok(())
        }
    }
}
