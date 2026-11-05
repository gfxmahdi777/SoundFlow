use windows::core::{implement, interface, GUID, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Media::Audio::{eConsole, eMultimedia, eRender, EDataFlow, ERole};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// Windows 10/11 AudioSes.dll IAudioPolicyConfig Factory CLSID
pub const CLSID_AUDIO_POLICY_CONFIG: GUID =
    GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

/// Windows 7/10/11 PolicyConfigClient CLSID for system default endpoint switching
pub const CLSID_POLICY_CONFIG_CLIENT: GUID =
    GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
pub unsafe trait IPolicyConfig: windows::core::IUnknown {
    pub unsafe fn GetMixFormat(&self, device_id: PCWSTR, format: *mut *mut std::ffi::c_void) -> HRESULT;
    pub unsafe fn GetDeviceFormat(
        &self,
        device_id: PCWSTR,
        default: i32,
        format: *mut *mut std::ffi::c_void,
    ) -> HRESULT;
    pub unsafe fn ResetDeviceFormat(&self, device_id: PCWSTR) -> HRESULT;
    pub unsafe fn SetDeviceFormat(
        &self,
        device_id: PCWSTR,
        endpoint_format: *const std::ffi::c_void,
        mix_format: *const std::ffi::c_void,
    ) -> HRESULT;
    pub unsafe fn GetProcessingPeriod(
        &self,
        device_id: PCWSTR,
        default: i32,
        default_period: *mut i64,
        min_period: *mut i64,
    ) -> HRESULT;
    pub unsafe fn SetProcessingPeriod(&self, device_id: PCWSTR, period: *const i64) -> HRESULT;
    pub unsafe fn GetShareMode(&self, device_id: PCWSTR, mode: *mut std::ffi::c_void) -> HRESULT;
    pub unsafe fn SetShareMode(&self, device_id: PCWSTR, mode: *const std::ffi::c_void) -> HRESULT;
    pub unsafe fn GetPropertyValue(
        &self,
        device_id: PCWSTR,
        fx_store: i32,
        key: *const std::ffi::c_void,
        value: *mut std::ffi::c_void,
    ) -> HRESULT;
    pub unsafe fn SetPropertyValue(
        &self,
        device_id: PCWSTR,
        fx_store: i32,
        key: *const std::ffi::c_void,
        value: *const std::ffi::c_void,
    ) -> HRESULT;
    pub unsafe fn SetDefaultEndpoint(&self, device_id: PCWSTR, role: ERole) -> HRESULT;
    pub unsafe fn SetEndpointVisibility(&self, device_id: PCWSTR, visible: i32) -> HRESULT;
}

/// Windows 10 RS4+ / Windows 11 IAudioPolicyConfig interface for per-process audio endpoint routing
/// (`SetPersistedDefaultAudioEndpoint`)
#[interface("ab3d4648-e242-459f-b02f-541c70306324")]
pub unsafe trait IAudioPolicyConfigFactory: windows::core::IUnknown {
    pub unsafe fn __incomplete_vtable_slot_1(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_2(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_3(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_4(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_5(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_6(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_7(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_8(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_9(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_10(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_11(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_12(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_13(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_14(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_15(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_16(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_17(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_18(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_19(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_20(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_21(&self) -> HRESULT;
    pub unsafe fn __incomplete_vtable_slot_22(&self) -> HRESULT;
    pub unsafe fn SetPersistedDefaultAudioEndpoint(
        &self,
        process_id: u32,
        flow: EDataFlow,
        role: ERole,
        device_id: HSTRING,
    ) -> HRESULT;
    pub unsafe fn GetPersistedDefaultAudioEndpoint(
        &self,
        process_id: u32,
        flow: EDataFlow,
        role: ERole,
        device_id: *mut HSTRING,
    ) -> HRESULT;
    pub unsafe fn ClearAllPersistedApplicationDefaultEndpoints(&self) -> HRESULT;
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
            if let Ok(factory) =
                windows::Win32::System::WinRT::RoGetActivationFactory::<IAudioPolicyConfigFactory>(
                    &class_name,
                )
            {
                let target_hstring = Self::format_mmdevice_to_devinterface(device_id);
                let hr1 = factory.SetPersistedDefaultAudioEndpoint(
                    pid,
                    eRender,
                    eMultimedia,
                    target_hstring.clone(),
                );
                let hr2 =
                    factory.SetPersistedDefaultAudioEndpoint(pid, eRender, eConsole, target_hstring);
                if hr1.is_ok() || hr2.is_ok() {
                    return Ok(());
                }
            }
            Ok(())
        }
    }

    /// Sets the system-wide default playback audio endpoint across Console & Multimedia roles.
    pub fn set_system_default_endpoint(&self, device_id: &str) -> Result<(), String> {
        unsafe {
            if let Ok(policy) =
                CoCreateInstance::<_, IPolicyConfig>(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL)
            {
                let wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
                let pcwstr = PCWSTR(wide.as_ptr());
                let _ = policy.SetDefaultEndpoint(pcwstr, eConsole);
                let _ = policy.SetDefaultEndpoint(pcwstr, eMultimedia);
            }
            Ok(())
        }
    }
}
