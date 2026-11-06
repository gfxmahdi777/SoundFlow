#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod audio_engine;
#[cfg(target_os = "windows")]
mod com_policy;

use std::sync::Mutex;
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[cfg(target_os = "windows")]
use audio_engine::{AppAudioSessionDto, AudioOutputDeviceDto, CoreAudioEngine};

#[cfg(not(target_os = "windows"))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[cfg(not(target_os = "windows"))]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[cfg(not(target_os = "windows"))]
pub struct CoreAudioEngine;
#[cfg(not(target_os = "windows"))]
impl CoreAudioEngine {
    pub fn new() -> Self {
        Self
    }
    pub fn get_audio_devices(&self) -> Result<Vec<AudioOutputDeviceDto>, String> {
        Ok(vec![])
    }
    pub fn get_audio_sessions(&self) -> Result<Vec<AppAudioSessionDto>, String> {
        Ok(vec![])
    }
    pub fn set_app_audio_device(&mut self, _pid: u32, _device_id: String) -> Result<(), String> {
        Ok(())
    }
    pub fn set_app_volume(&self, _pid: u32, _volume: f32) -> Result<(), String> {
        Ok(())
    }
    pub fn set_app_mute(&self, _pid: u32, _muted: bool) -> Result<(), String> {
        Ok(())
    }
    pub fn set_default_audio_device(&self, _device_id: String) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
fn get_audio_devices(
    state: tauri::State<'_, Mutex<CoreAudioEngine>>,
) -> Result<Vec<AudioOutputDeviceDto>, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    engine.get_audio_devices()
}

#[tauri::command]
fn get_audio_sessions(
    state: tauri::State<'_, Mutex<CoreAudioEngine>>,
) -> Result<Vec<AppAudioSessionDto>, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    engine.get_audio_sessions()
}

#[tauri::command]
fn set_app_audio_device(
    state: tauri::State<'_, Mutex<CoreAudioEngine>>,
    pid: u32,
    device_id: String,
) -> Result<(), String> {
    let mut engine = state.lock().map_err(|e| e.to_string())?;
    engine.set_app_audio_device(pid, device_id)
}

#[tauri::command]
fn set_app_volume(
    state: tauri::State<'_, Mutex<CoreAudioEngine>>,
    pid: u32,
    volume: f32,
) -> Result<(), String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    engine.set_app_volume(pid, volume)
}

#[tauri::command]
fn set_app_mute(
    state: tauri::State<'_, Mutex<CoreAudioEngine>>,
    pid: u32,
    muted: bool,
) -> Result<(), String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    engine.set_app_mute(pid, muted)
}

#[tauri::command]
fn set_default_audio_device(
    state: tauri::State<'_, Mutex<CoreAudioEngine>>,
    device_id: String,
) -> Result<(), String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    engine.set_default_audio_device(device_id)
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(CoreAudioEngine::new()))
        .setup(|app| {
            // Force show the window immediately on startup
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap();
                window.set_focus().unwrap();
            }

            // V2 Tray Logic
            let mut tray_builder = TrayIconBuilder::new();
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_audio_devices,
            get_audio_sessions,
            set_app_audio_device,
            set_app_volume,
            set_app_mute,
            set_default_audio_device
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
