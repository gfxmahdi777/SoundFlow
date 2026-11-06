# SoundFlow — Real-Time WASAPI Audio Peak Metering & Active Session Filtering Plan

This update adds real-time visual VU / peak volume meters powered by Windows `IAudioMeterInformation` (similar to the Windows Volume Mixer live level bar) across both Connected Devices and Application Routing cards, while also filtering out inactive sessions and extracting clean, human-readable application names via Win32 version resources.

## User Review & Critical Decisions

> [!IMPORTANT]
> This plan combines your real-time VU meter request with the active-session filtering and clean application naming improvements so both land together cleanly in the next build.

- **Real-Time Peak Metering (~65ms Rust Loop)**: A dedicated background thread in Tauri queries `IAudioMeterInformation::GetPeakValue()` (`0.0` to `1.0`) for all active audio sessions and physical output devices every `65ms` and emits `"audio_meter_update"` to the React frontend.
- **Smooth Visualizer Bars (`75ms ease-out`)**: Both Connected Device cards and Application Routing cards display a sleek horizontal peak meter bar with `transition: width 75ms ease-out, background-color 100ms ease`, disappearing cleanly (`width: 0%` / `opacity: 0`) when peak volume is `0`.
- **Active-Only Session Filtering & Clean App Names**: Only sessions in `AudioSessionStateActive` (`1`) with non-zero PIDs are shown, and application names are extracted from the executable's Win32 `FileDescription` / `ProductName` metadata (`VerQueryValueW`) with a clean title-cased fallback and `"Unknown App"` guard.

---

## 1. Overview & Core Concept

- **What It Does**: Lets users immediately see which physical output device and which running applications are actively producing sound in real time via responsive, smooth-bouncing peak volume bars inside the `400 × 560 px` Glassmorphism White popup.
- **Target Audience / Persona**: Windows 10 & 11 power users, creators, and gamers routing per-app audio from the system tray who want instant visual confirmation of live audio activity and clean application lists.
- **Key Value**: Eliminates guesswork about which app is making sound and replaces cluttered inactive/raw process entries (`process_3596`, `brave`) with only active, cleanly named applications.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Live Application VU Metering**: As an app (e.g., *Brave Browser*, *Spotify*, *VLC Media Player*) plays audio, a slim emerald-to-blue gradient peak meter bar embedded beneath/behind its volume slider bounces smoothly at ~15–20 fps (`75ms ease-out`), turning amber/coral when peaking near `0.85–1.0`.
  2. **Live Device Peak Metering**: Each Connected Device card in the top section displays a subtle real-time horizontal VU bar along its bottom edge reflecting the hardware endpoint's master `IAudioMeterInformation::GetPeakValue()`.
  3. **Silence / Zero State**: When an application or device is silent (`peak <= 0.005` or muted), the meter bar smoothly retracts to `0%` width and becomes invisible.
  4. **Clean Active Session List**: Only applications actively outputting audio (`AudioSessionStateActive`) appear in the Application Routing list with their friendly Win32 `FileDescription` (or `"Unknown App"` fallback if metadata is missing).
- **Visual Identity & Theme**:
  - Preserves the **Glassmorphism White (`#F5F8FF`)** palette (`rgba(255,255,255,0.72)` surfaces, `#3478F6` Primary Blue, `#16A36A` Success Green, `#172033` Main Text).
  - **Meter Color Dynamics**:
    - Normal audio (`0.01 – 0.65`): `#16A36A` (Emerald Green) to `#3478F6` (Primary Blue) gradient.
    - High level (`0.65 – 0.85`): `#F59E0B` (Warm Amber) accent.
    - Peak level (`> 0.85`): `#EF4444` (Peak Coral).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dedicated Background Rust Metering Thread (`65ms` Cadence)**
  - *Chosen Approach*: Spawn a lightweight background thread inside Tauri's `.setup()` hook that initializes COM (`COINIT_MULTITHREADED`), samples `IAudioMeterInformation::GetPeakValue()` for active devices and sessions every `65ms`, and calls `app_handle.emit("audio_meter_update", payload)`.
  - *Why*: Keeps the main Win32 UI thread 100% non-blocking while matching the `75ms ease-out` CSS transition so the bar glides continuously without jitter or CPU spikes.
- **Decision 2: Win32 `VerQueryValueW` File Description Extraction**
  - *Chosen Approach*: Query the executable's `\VarFileInfo\Translation` and `\StringFileInfo\<lang-codepage>\FileDescription` (and `ProductName`) via `GetFileVersionInfoW` / `VerQueryValueW`, falling back to a clean capitalized executable stem without `.exe`.
  - *Why*: Converts raw process names like `brave.exe` or `Spotify.exe` into official application titles like `"Brave Browser"` or `"Spotify"`.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    Tauri 2 Rust Backend (Windows Core Audio)              │
│                                                                           │
│  ┌───────────────────────────────┐    ┌────────────────────────────────┐  │
│  │  Session & Device Enumerator  │    │  65ms Background Meter Thread  │  │
│  │  • IMMDeviceEnumerator        │    │  • IMMDevice::Activate         │  │
│  │  • IAudioSessionControl::     │    │    -> IAudioMeterInformation   │  │
│  │    GetState == Active (1)     │    │  • IAudioSessionControl::cast  │  │
│  │  • VerQueryValueW FileDesc    │    │    -> IAudioMeterInformation   │  │
│  │    + Capitalized Fallback     │    │  • GetPeakValue() (0.0..1.0)   │  │
│  └──────────────┬────────────────┘    └───────────────┬────────────────┘  │
└─────────────────┼─────────────────────────────────────┼───────────────────┘
                  │ Tauri IPC invoke                    │ app_handle.emit(
                  │ (get_audio_sessions / devices)      │ "audio_meter_update")
                  ▼                                     ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                  React Frontend (400 × 560 Glassmorphism UI)              │
│                                                                           │
│  ┌───────────────────────────────┐    ┌────────────────────────────────┐  │
│  │  Connected Devices Section    │    │  Application Routing Cards     │  │
│  │  • Device peak meter bar      │    │  • Active sessions only        │  │
│  │  • width: peak * 100%         │    │  • Clean app title / Unknown   │  │
│  │  • transition: width 75ms     │    │  • Integrated VU bar under     │  │
│  │    ease-out                   │    │    volume slider (75ms ease)   │  │
│  └───────────────────────────────┘    └────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Event Payload
- **`AudioMeterUpdatePayload` (`"audio_meter_update"` event)**:
  - `sessionPeaks: Record<number, number>` — maps process `pid` (`u32`) to peak value (`0.0` to `1.0`).
  - `devicePeaks: Record<string, number>` — maps `device_id` (`String`) to peak value (`0.0` to `1.0`).
- **Interactive Component & State Mapping**:
  - `tauriBridge.ts` subscribes to `"audio_meter_update"` via `listen<AudioMeterUpdatePayload>("audio_meter_update", ...)` and feeds real-time peak values (`0.0` to `1.0`) directly into `SoundFlowPopup.tsx`.
  - When `peak <= 0.005` or the app/device is muted, the visualizer bar width is `0%` and `opacity: 0`. When active, `width: ${Math.min(100, Math.round(peak * 100))}%` with `transition: width 75ms ease-out, background-color 0.1s ease, opacity 75ms ease-out`.
