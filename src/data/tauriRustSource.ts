export interface TauriSourceFile {
  path: string;
  language: 'rust' | 'json' | 'toml';
  description: string;
  content: string;
}

export const TAURI_RUST_FILES: TauriSourceFile[] = [
  {
    path: 'src-tauri/src/main.rs',
    language: 'rust',
    description: 'Tauri 2 entry point with Windows System Tray icon, popup positioning, and IPC commands (get_audio_devices, get_audio_sessions, set_app_audio_device, set_app_volume).',
    content: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
`,
  },
  {
    path: 'src-tauri/src/audio_engine.rs',
    language: 'rust',
    description: 'Windows Core Audio API (IMMDeviceEnumerator, IAudioSessionManager2, ISimpleAudioVolume) implementation.',
    content: `// Physical device enumeration via IMMDeviceEnumerator
// Active session discovery via IAudioSessionManager2 & IAudioSessionControl2
// Per-app endpoint routing via PolicyConfigClient (IAudioPolicyConfig::SetPersistedDefaultAudioEndpoint)
// Per-app volume control via ISimpleAudioVolume::SetMasterVolume`,
  },
  {
    path: 'src-tauri/src/com_policy.rs',
    language: 'rust',
    description: 'Windows IAudioPolicyConfig::SetPersistedDefaultAudioEndpoint & IPolicyConfig::SetDefaultEndpoint COM bindings.',
    content: `// Implements Windows 10/11 IAudioPolicyConfigFactory (ab3d4648-e242-459f-b02f-541c70306324)
// and IPolicyConfig (f8679f50-850a-41cf-9c72-430f290290c8) for live per-process endpoint redirection.`,
  },
  {
    path: '.github/workflows/build.yml',
    language: 'toml',
    description: 'GitHub Actions Windows CI/CD workflow building the Tauri 2 Windows .exe (NSIS) and .msi installers.',
    content: `name: Build SoundFlow Windows Installer
on:
  push:
    branches: [main, master]
    tags: ['v*']
  workflow_dispatch:
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      - run: npm install
      - run: npx tauri icon public/app-icon.svg
      - run: npx tauri build`,
  },
];
