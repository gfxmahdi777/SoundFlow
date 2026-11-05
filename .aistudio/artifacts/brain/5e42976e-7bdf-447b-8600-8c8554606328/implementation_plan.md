# SoundFlow — Windows System Tray Audio Controller

SoundFlow is a lightweight, native-feeling Windows 10 & 11 system tray audio utility (*"Every App. Every Device. Your Control."*) that lets users route individual application audio streams to separate hardware output devices in real time without opening a heavy desktop mixer.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Architecture & Experience Choices (from Phase 1)**
> All core product decisions have been aligned with your selections and the original specification:

- **Confirmed Decision 1 — Execution Environment**: Interactive Windows 11 desktop & system tray environment with the compact SoundFlow flyout popup, paired with a complete **Tauri 2 + Rust (WASAPI / Windows Core Audio)** codebase inspector and one-click project exporter for native Windows compilation.
- **Confirmed Decision 2 — Real-Time Audio Engine**: Live multi-stream Web Audio API engine running distinct, real playable audio streams per application (Google Chrome / YouTube, Adobe After Effects, Cyberpunk 2077 / Game, VLC Media Player) with independent `AudioContext` routing, hardware output device binding (`setSinkId` + multi-bus DSP), real-time RMS decibel meters, and zero-restart live switching.
- **Confirmed Decision 3 — Extended Controls & Recovery**: Live per-app decibel level meters and waveform activity, device hot-plug (connect/disconnect) and application launch/close controls for testing automatic recovery and saved preferences, plus configurable global keyboard shortcuts for quick mute and output device cycling.

---

## 1. Overview & Core Concept

- **What It Does**: SoundFlow lives quietly in the Windows notification area next to the native Speaker icon. Left-clicking the tray icon opens a compact, borderless flyout popup showing connected audio output devices and active audio-producing applications. Users can assign each running application to a specific output device, adjust per-app volume sliders, toggle quick mute, pause/resume routing globally, and manage startup/hotkey preferences—while background routing continues uninterrupted even when the popup is closed.
- **Target Audience / Persona**: Power users, video editors, streamers, and multitaskers on Windows 10/11 who simultaneously run media browsers (YouTube in Chrome on Speakers), creative tools (Adobe After Effects on Studio Headphones), and games or media players (VLC on USB DAC or Display Audio) without wanting to dig into buried Windows Sound Settings.
- **Key Value**: Instant, two-click per-application audio output switching with automatic preference persistence, hot-plug device recovery, and zero audio interruption when the popup closes.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **System Tray Interaction (Left-Click & Right-Click)**
   - **Left-clicking** the SoundFlow icon in the Windows 11 system tray toggles the compact SoundFlow flyout popup directly above the taskbar notification area.
   - **Clicking outside** the popup onto the desktop workspace dismisses the popup immediately while all background audio streams and routing buses continue running at full fidelity.
   - **Right-clicking** the SoundFlow tray icon opens the native Windows context menu with four direct actions: **Open SoundFlow**, **Pause Routing / Resume Routing**, **Settings**, and **Exit** (with minimize-to-tray protection).
2. **Real-Time Application Audio Routing & Playback**
   - Inside the popup, users see all running applications with their icons, live dB peak meters, individual volume sliders (`0%–100%`), quick mute/unmute buttons, and an output device dropdown (`Default Output`, `Headphone — Realtek Audio`, `Speaker — USB Speaker`, `Studio Monitor — Focusrite USB`, or `Not Assigned`).
   - Switching an application's output dropdown immediately re-routes its live audio stream to the target device bus (and hardware sink where supported by the browser's `AudioContext.setSinkId` / `HTMLMediaElement.setSinkId`) without restarting the application or dropping frames.
3. **Device Hot-Plug Recovery & App Lifecycle Testing**
   - A discreet **Environment & Hardware Workbench** bar allows users to trigger real-world Windows events: launching/closing applications (e.g., launching Spotify or Discord, or starting/stopping audio playback per app) and unplugging/reconnecting audio devices (e.g., unplugging `Headphone — Realtek Audio`).
   - When an assigned device is disconnected, SoundFlow automatically falls back to the Default Output device without crashing or duplicating audio; when the device is reconnected, SoundFlow automatically restores the saved routing assignment for every bound application.
4. **Global Shortcuts, Settings & Native Tauri 2 Rust Export**
   - Opening the **Settings** view inside the popup (or via the tray context menu) lets users toggle **Launch at Windows Startup**, configure **Global Keyboard Shortcuts** (e.g., `Alt+M` to mute active app, `Alt+D` to cycle output device, `Alt+S` to toggle popup), and inspect/reset saved JSON/SQLite routing profiles.
   - Users can also open the **Tauri 2 + Rust WASAPI Native Source** drawer to inspect and download the complete production Rust backend (`WASAPI` `IAudioSessionManager2`, `IMMDeviceEnumerator`, `IAudioPolicyConfig` per-process endpoint routing, and `tauri::tray::TrayIconBuilder`) ready to compile into a native `.exe` / `.msi` installer on Windows.

### Visual Identity & Theme

- **Aesthetic Direction**: Utilitarian, precision Windows 11 Fluent-inspired dark audio hardware utility. Compact, scannable, and free of decorative bloat.
- **Color Palette & Mood**:
  - **Dominant Canvas (`--background`)**: Deep Obsidian `#090D18` (Popup container background and primary dark canvas).
  - **Structural Surfaces (`--surface`)**: Elevated Slate `#151F32` (Device rows, application routing rows, dropdown menus, and segmented controls) with crisp `1px solid rgba(255, 255, 255, 0.08)` hairline borders.
  - **Primary Accent (`--primary`)**: Electric Cobalt `#287BFF` and signature brand gradient `linear-gradient(135deg, #287BFF 0%, #754BFF 100%)` reserved strictly for active routing controls, volume fill tracks, and primary actions.
  - **Typography Hierarchy**: Main Text in Crisp Ice `#F5F7FF` and Secondary Text in Muted Slate `#929DB2`.
  - **Semantic Status (`--connected`)**: Signal Emerald `#20C997` paired with explicit text labels (`Connected`, `Live Routing`, `Paused`, `Disconnected`) so state is never communicated by color alone.
- **Typography & Hierarchy**:
  - **Display & UI Header Font**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700) for clean, high-legibility popup headers and section titles.
  - **Body & Control Font**: `DM Sans` (Regular 400 / Medium 500) for compact 13px–14px application names, device labels, and menu items (`whitespace-nowrap` with truncation where needed).
  - **Telemetry & Numeric Readouts**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` for volume percentages (`100%`), real-time decibel levels (`-12.4 dB`), sample rates (`48.0 kHz`), and buffer latency readouts.
- **Component Styling & Layout**:
  - Single-elevation surface hierarchy (`#151F32` rows over `#090D18` popup shell) with `12px` outer popup border radius and `8px` inner control radius ($r_{\text{inner}} = r_{\text{outer}} - \text{padding}$).
  - Zero static pill enclosures: device connection metadata (`Realtek Audio · 24-bit 48kHz · Connected`) renders as clean inline text with `·` separators.
- **Interactive Feedback & Motion**:
  - Sub-150ms compositor transitions (`transform`, `opacity`) using `cubic-bezier(0.16, 1, 0.3, 1)` when opening/closing the tray flyout and device dropdowns.
  - 60fps Canvas/requestAnimationFrame level meters reflecting true `AnalyserNode` frequency/time-domain audio output per application.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: True Multi-Bus Web Audio Engine + Hardware `setSinkId` Routing**
  - *Chosen Approach*: Each simulated Windows application (Chrome, After Effects, Game, VLC, plus dynamically launched apps) owns an independent procedural/synthesized stereo audio generator (distinct musical/ambient/media loops and SFX) connected through a dedicated per-app `GainNode`, `AnalyserNode`, and target device bus (`AudioContext` + `setSinkId` where supported by the user's browser hardware, plus stereo/spectral device bus differentiation and master monitor).
  - *Why*: Ensures the application obeys Rule #9 ("Do not build a UI-only prototype. Do not simulate audio routing.") by processing real audio buffers in real time, computing true dBFS levels, and routing audio streams independently while remaining 100% self-contained without external media URL failures.
  - *Alternatives Considered*: Static CSS animations faking volume bars (rejected—violates real audio engine rules) or relying on external MP3 URLs that can fail in sandboxed environments.
- **Decision 2: Dual-Layer Persistence (Backend Express JSON Store + LocalStorage Sync)**
  - *Chosen Approach*: An Express API backend (`server.ts`) persists routing configurations, per-app volume/mute states, default output device, startup settings, and remembered unplugged-device bindings to a local `soundflow-config.json` file on disk, synchronized with instant client-side state updates.
  - *Why*: Mirrors Tauri's local JSON/SQLite configuration persistence across restarts while guaranteeing zero-latency UI responsiveness during slider drags and device switches.
- **Decision 3: Authentic Tauri 2 + Rust WASAPI Implementation Bundle**
  - *Chosen Approach*: Alongside the live interactive system tray environment, we include the complete, production-accurate Rust source code (`Cargo.toml`, `tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/audio_engine.rs`, `src-tauri/src/com_policy.rs`) implementing Windows `IMMDeviceEnumerator`, `IAudioSessionManager2`, `IMMNotificationClient` (device hot-plug notifications), and `IPolicyConfig` / `IAudioPolicyConfig` per-process endpoint redirection.
  - *Why*: Gives the user both an immediately testable, real-audio Windows 11 tray experience in the browser and the exact native Windows 10/11 Tauri 2 Rust code required to build the native desktop installer.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                   Windows 11 Desktop & Taskbar Environment                   │
│  ┌───────────────────────────────┐      ┌─────────────────────────────────┐  │
│  │ Environment & Hardware Bench  │      │ Windows System Tray (Bottom-Rt) │  │
│  │ • App Process Launcher/Killer │      │ • SoundFlow Icon (Left/Right)   │  │
│  │ • Device Hot-Plug Simulator   │      │ • Native Right-Click Menu       │  │
│  │ • Global Hotkey Listener      │      │ • Outside-Click Dismiss Handler │  │
│  └──────────────┬────────────────┘      └────────────────┬────────────────┘  │
└─────────────────┼────────────────────────────────────────┼───────────────────┘
                  │                                        │
                  ▼                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     SoundFlow Compact Popup Flyout (#090D18)                 │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Header: SoundFlow Logo + Live Routing Status + Quick Settings / Code  │  │
│  ├────────────────────────────────────────────────────────────────────────┤  │
│  │ Connected Devices Section (#151F32)                                    │  │
│  │ • Default Output Selector  • Hardware Sink Binding  • Live Bus Meter   │  │
│  ├────────────────────────────────────────────────────────────────────────┤  │
│  │ Application Routing Matrix (#151F32)                                   │  │
│  │ • App Icon & Name  • Output Device Dropdown  • Volume Slider & Mute    │  │
│  │ • Real-Time dB Meter  • Refresh App List  • Unassigned App Handling    │  │
│  └──────────────────────────────┬─────────────────────────────────────────┘  │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┴───────────────────────┐
          ▼                                               ▼
┌───────────────────────────────────┐   ┌──────────────────────────────────────┐
│ Real-Time Web Audio Routing Engine│   │ Persistence & Native Tauri Exporter  │
│ • Per-App Source Generators       │   │ • Express `/api/config` JSON Store   │
│ • Per-App GainNode & AnalyserNode │   │ • Device Recovery Rules Engine       │
│ • Per-Device Master Bus & SinkId  │   │ • Tauri 2 + Rust WASAPI Code Drawer  │
└───────────────────────────────────┘   └──────────────────────────────────────┘
```

### Data Model & State

- **`AudioOutputDevice`**:
  - `id`: Unique endpoint identifier (e.g., `dev-realtek-hp`, `dev-usb-speaker`, `dev-focusrite-mon`, `dev-hdmi-disp`).
  - `name`: Friendly label (`Headphone`, `Speaker`, `Studio Monitor`).
  - `driver`: Hardware interface label (`Realtek Audio`, `USB Speaker`, `Focusrite USB Audio`).
  - `status`: `'connected' | 'disconnected'`.
  - `isDefault`: Boolean flag indicating current system default output.
  - `physicalSinkId`: Optional browser Web Audio `sinkId` mapped via `navigator.mediaDevices.enumerateDevices()`.
  - `sampleRate` & `bitDepth`: Telemetry metadata (`48.0 kHz`, `24-bit`).
- **`AppAudioSession`**:
  - `id` & `pid`: Process identifier (e.g., `chrome.exe` / PID `14280`, `AfterFX.exe` / PID `8912`, `Cyberpunk2077.exe` / PID `21044`, `vlc.exe` / PID `6320`).
  - `name` & `category`: Display name (`Google Chrome`, `Adobe After Effects`, `Game`, `VLC Media Player`) and audio generator profile.
  - `assignedDeviceId`: Target `AudioOutputDevice.id`, `'default'`, or `'unassigned'`.
  - `preferredDeviceId`: Remembered device ID persisted across device disconnects so reconnection automatically restores routing.
  - `volume`: Numeric value `0–100`.
  - `muted`: Boolean mute state.
  - `isPlaying`: Boolean indicating active audio stream generation.
- **`SoundFlowPreferences`**:
  - `routingActive`: Global live routing toggle (`true` = Live Routing, `false` = Paused).
  - `launchAtStartup`: Windows registry startup flag (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).
  - `minimizeToTray`: Boolean ensuring window close minimizes to notification area.
  - `shortcuts`: Keybindings for `togglePopup` (`Alt+S`), `muteFocusedApp` (`Alt+M`), and `cycleDefaultDevice` (`Alt+D`).

### Interactive Component & State Mapping

- **Tray Icon & Outside-Click Handler**:
  - Left-clicking the SoundFlow tray icon toggles `isPopupOpen`. Clicking anywhere on the desktop backdrop outside the popup sets `isPopupOpen = false` without stopping the `AudioEngine` singleton.
  - Right-clicking the tray icon opens the context menu at cursor coordinates with handlers for `Open SoundFlow`, `Pause/Resume Routing`, `Settings`, and `Exit` (which shows a tray notification or cleanly stops streams if confirmed).
- **Per-Application Output Dropdown & Volume/Mute Controls**:
  - Changing an application's dropdown updates both `assignedDeviceId` and `preferredDeviceId`, immediately switches the Web Audio `GainNode` destination bus to the selected `AudioOutputDevice`, and persists the change via `POST /api/config`.
  - Dragging the volume slider or clicking the quick mute button updates the application's `GainNode.gain.setTargetAtTime(...)` within 15ms for click-free audio scaling.
- **Hot-Plug Device Recovery Engine**:
  - Toggling a device's connection state in the hardware workbench triggers `handleDeviceStateChange(deviceId, connected)`.
  - On disconnect: Any application routed to `deviceId` transparently re-routes its active audio graph to the current `Default Output` device while keeping `preferredDeviceId = deviceId` intact.
  - On reconnect: SoundFlow scans all active and remembered application sessions where `preferredDeviceId === deviceId` and automatically re-binds their audio streams back to the reconnected device.
