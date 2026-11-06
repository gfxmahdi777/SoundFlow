#![allow(non_snake_case, non_camel_case_types)]

use std::ffi::c_void;
use windows::core::{IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Media::Audio::{eConsole, eMultimedia, eRender, EDataFlow, ERole};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::WinRT::RoGetActivationFactory;

/// Windows 7/10/11 PolicyConfigClient CLSID for system default endpoint switching
pub const CLSID_POLICY_CONFIG_CLIENT: GUID =
    GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// IPolicyConfig IID: {f8679f50-850a-41cf-9c72-430f290290c8}
pub const IID_IPOLICY_CONFIG: GUID =
    GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

/// Windows 10 RS4+ / Windows 11 IAudioPolicyConfigFactory IID: {ab3d4648-e242-459f-b02f-541c70306324}
pub const IID_IAUDIO_POLICY_CONFIG_FACTORY: GUID =
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
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        Ok(Self)
    }

    /// Formats a raw MMDevice ID (`{0.0.0.00000000}.{guid}`) into the WinRT DEVINTERFACE_AUDIO_RENDER
    /// string required by `IAudioPolicyConfig::SetPersistedDefaultAudioEndpoint`.
    fn format_mmdevice_to_devinterface(device_id: &str) -> HSTRING {
        if device_id.is_empty() || device_id == "default" || device_id == "unassigned" {
            return HSTRING::new();
        }
        if device_id.starts_with(r"\\?\SWD#MMDEVAPI#") {
            return HSTRING::from(device_id);
        }
        let formatted = format!(
            r"\\?\SWD#MMDEVAPI#{device_id}#{{e6327cad-dcec-4949-ae8a-991e976a79d2}}"
        );
        HSTRING::from(formatted)
    }

    /// Routes a specific Windows application (by PID) to a physical audio output device.
    /// Passing `"default"` or `""` clears the override so the app follows the system default.
    pub fn set_app_endpoint(&self, pid: u32, device_id: &str) -> Result<(), String> {
        unsafe {
            let class_name = HSTRING::from("Windows.Media.Internal.AudioPolicyConfig");
            if let Ok(unknown) = RoGetActivationFactory::<IUnknown>(&class_name) {
                let mut raw_ptr: *mut c_void = std::ptr::null_mut();
                if unknown
                    .query(&IID_IAUDIO_POLICY_CONFIG_FACTORY, &mut raw_ptr)
                    .is_ok()
                    && !raw_ptr.is_null()
                {
                    let vtbl = *(raw_ptr as *const *const IAudioPolicyConfigFactory_Vtbl);
                    let target_hstring = Self::format_mmdevice_to_devinterface(device_id);
                    let raw_hstring: *mut c_void = std::mem::transmute_copy(&target_hstring);

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
                    let _ = ((*vtbl).base__.Release)(raw_ptr);
                }
            }
            Ok(())
        }
    }

    /// Sets the system-wide default playback audio endpoint across Console & Multimedia roles.
    pub fn set_system_default_endpoint(&self, device_id: &str) -> Result<(), String> {
        unsafe {
            if let Ok(unknown) =
                CoCreateInstance::<_, IUnknown>(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
            {
                let mut raw_ptr: *mut c_void = std::ptr::null_mut();
                if unknown.query(&IID_IPOLICY_CONFIG, &mut raw_ptr).is_ok() && !raw_ptr.is_null() {
                    let vtbl = *(raw_ptr as *const *const IPolicyConfig_Vtbl);
                    let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
                    let pcwstr = PCWSTR(wide.as_ptr());
                    let _ = ((*vtbl).SetDefaultEndpoint)(raw_ptr, pcwstr, eConsole);
                    let _ = ((*vtbl).SetDefaultEndpoint)(raw_ptr, pcwstr, eMultimedia);
                    let _ = ((*vtbl).base__.Release)(raw_ptr);
                }
            }
            Ok(())
        }
    }
}
