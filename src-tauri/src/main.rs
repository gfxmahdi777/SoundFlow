#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod audio_engine;
#[cfg(target_os = "windows")]
mod com_policy;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};

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

fn position_flyout_near_tray<R: Runtime>(app: &AppHandle<R>, tray_rect: tauri::Rect) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(win_size) = window.outer_size() {
            let pos = match tray_rect.position {
                tauri::Position::Physical(p) => p,
                _ => tauri::PhysicalPosition::new(1480, 1020),
            };
            let x = (pos.x - (win_size.width as i32 / 2)).max(16);
            let y = (pos.y - win_size.height as i32 - 12).max(16);
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(CoreAudioEngine::new()))
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open SoundFlow", true, None::<&str>)?;
            let pause_item = MenuItem::with_id(app, "pause", "Pause Routing", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let exit_item = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[&open_item, &pause_item, &settings_item, &sep, &exit_item],
            )?;

            let mut tray_builder = TrayIconBuilder::with_id("soundflow-tray")
                .tooltip("SoundFlow — Windows Audio Controller")
                .menu(&tray_menu)
                .show_menu_on_left_click(false);

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "pause" => {
                        let _ = app.emit("tray://toggle-pause", ());
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = app.emit("tray://open-settings", ());
                        }
                    }
                    "exit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                position_flyout_near_tray(app, rect);
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            if let Some(main_win) = app.get_webview_window("main") {
                let win_clone = main_win.clone();
                main_win.on_window_event(move |event| match event {
                    WindowEvent::Focused(false) => {
                        let _ = win_clone.hide();
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                    _ => {}
                });
            }

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
        .expect("error while running SoundFlow Tauri application");
}
