/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  AppAudioSession,
  AudioTelemetryFrame,
  DeviceConnectionStatus,
  GlobalShortcutsConfig,
  RoutingLogEntry,
  SavedAppPreference,
  SoundFlowConfig,
} from './types/soundflow';
import { soundFlowEngine } from './services/audioEngine';
import {
  isTauriRuntime,
  subscribeToTauriAudioMeters,
  subscribeToTauriTrayEvents,
  tauriGetAudioDevices,
  tauriGetAudioSessions,
  tauriSetAppAudioDevice,
  tauriSetAppMute,
  tauriSetAppVolume,
  tauriSetDefaultAudioDevice,
  tauriSetDeviceMute,
  tauriSetDeviceVolume,
} from './services/tauriBridge';
import { SoundFlowPopup } from './components/SoundFlowPopup';
import {
  AdvancedSettingsModal,
  LaunchableProcessTemplate,
} from './components/AdvancedSettingsModal';
import { TauriCodeModal } from './components/TauriCodeModal';
import {
  ApplicationIcon,
  SoundFlowBrandIcon,
} from './components/AppIcons';
import {
  Volume2,
  VolumeX,
  Wifi,
  BatteryCharging,
  Sliders,
  ExternalLink,
  Power,
  PauseCircle,
  PlayCircle,
} from 'lucide-react';

const LAUNCHABLE_APPS: LaunchableProcessTemplate[] = [
  {
    executable: 'Spotify.exe',
    name: 'Spotify',
    windowTitle: 'Spotify Premium — Synthwave Focus Playlist',
    iconType: 'spotify',
    defaultPid: 18420,
  },
  {
    executable: 'Discord.exe',
    name: 'Discord',
    windowTitle: 'Voice Connected — Studio Production Channel',
    iconType: 'discord',
    defaultPid: 11904,
  },
  {
    executable: 'obs64.exe',
    name: 'OBS Studio',
    windowTitle: 'OBS 31.0 — 60fps NVENC Monitor Output',
    iconType: 'obs',
    defaultPid: 25610,
  },
  {
    executable: 'chrome.exe',
    name: 'Google Chrome',
    windowTitle: 'YouTube — 4K HDR Mastering Session',
    iconType: 'chrome',
    defaultPid: 14280,
  },
  {
    executable: 'AfterFX.exe',
    name: 'Adobe After Effects',
    windowTitle: 'SoundFlow_Launch_Reel_v4.aep *',
    iconType: 'after-effects',
    defaultPid: 8912,
  },
  {
    executable: 'Cyberpunk2077.exe',
    name: 'Game',
    windowTitle: 'Cyberpunk 2077 (DirectX 12)',
    iconType: 'game',
    defaultPid: 21044,
  },
  {
    executable: 'vlc.exe',
    name: 'VLC Media Player',
    windowTitle: 'Atmos_Reference_Check_24bit.flac',
    iconType: 'vlc',
    defaultPid: 6320,
  },
];

const INITIAL_FALLBACK_CONFIG: SoundFlowConfig = {
  routingActive: true,
  defaultDeviceId: 'dev-usb-speaker',
  launchAtStartup: true,
  minimizeToTray: true,
  autoRestoreOnReconnect: true,
  audioEngineInitialized: false,
  shortcuts: {
    togglePopup: 'Alt+S',
    muteActiveApp: 'Alt+M',
    cycleDefaultDevice: 'Alt+D',
    pauseResumeRouting: 'Alt+P',
  },
  devices: [
    {
      id: 'dev-realtek-hp',
      name: 'Headphone',
      driver: 'Realtek Audio',
      status: 'connected',
      formFactor: 'headphones',
      isDefault: false,
      sampleRate: '48.0 kHz',
      bitDepth: '24-bit',
      masterVolume: 90,
      muted: false,
    },
    {
      id: 'dev-usb-speaker',
      name: 'Speaker',
      driver: 'USB Speaker',
      status: 'connected',
      formFactor: 'speakers',
      isDefault: true,
      sampleRate: '48.0 kHz',
      bitDepth: '24-bit',
      masterVolume: 85,
      muted: false,
    },
    {
      id: 'dev-focusrite-dac',
      name: 'Studio Monitor',
      driver: 'Focusrite USB Audio',
      status: 'connected',
      formFactor: 'dac',
      isDefault: false,
      sampleRate: '96.0 kHz',
      bitDepth: '32-bit',
      masterVolume: 95,
      muted: false,
    },
    {
      id: 'dev-nvidia-hdmi',
      name: 'Display Audio',
      driver: 'NVIDIA High Definition Audio',
      status: 'disconnected',
      formFactor: 'monitor',
      isDefault: false,
      sampleRate: '48.0 kHz',
      bitDepth: '16-bit',
      masterVolume: 80,
      muted: false,
    },
  ],
  apps: [
    {
      id: 'app-chrome',
      pid: 14280,
      executable: 'chrome.exe',
      name: 'Google Chrome',
      windowTitle: 'YouTube — 4K HDR Mastering Session',
      iconType: 'chrome',
      assignedDeviceId: 'dev-usb-speaker',
      preferredDeviceId: 'dev-usb-speaker',
      volume: 85,
      muted: false,
      isPlaying: true,
      isFallbackActive: false,
    },
    {
      id: 'app-afterfx',
      pid: 8912,
      executable: 'AfterFX.exe',
      name: 'Adobe After Effects',
      windowTitle: 'SoundFlow_Launch_Reel_v4.aep *',
      iconType: 'after-effects',
      assignedDeviceId: 'dev-realtek-hp',
      preferredDeviceId: 'dev-realtek-hp',
      volume: 92,
      muted: false,
      isPlaying: true,
      isFallbackActive: false,
    },
    {
      id: 'app-game',
      pid: 21044,
      executable: 'Cyberpunk2077.exe',
      name: 'Game',
      windowTitle: 'Cyberpunk 2077 (DirectX 12)',
      iconType: 'game',
      assignedDeviceId: 'unassigned',
      preferredDeviceId: 'unassigned',
      volume: 78,
      muted: false,
      isPlaying: true,
      isFallbackActive: false,
    },
    {
      id: 'app-vlc',
      pid: 6320,
      executable: 'vlc.exe',
      name: 'VLC Media Player',
      windowTitle: 'Atmos_Reference_Check_24bit.flac',
      iconType: 'vlc',
      assignedDeviceId: 'dev-usb-speaker',
      preferredDeviceId: 'dev-usb-speaker',
      volume: 88,
      muted: false,
      isPlaying: true,
      isFallbackActive: false,
    },
  ],
  savedPreferences: {
    'chrome.exe': {
      executable: 'chrome.exe',
      preferredDeviceId: 'dev-usb-speaker',
      volume: 85,
      muted: false,
    },
    'AfterFX.exe': {
      executable: 'AfterFX.exe',
      preferredDeviceId: 'dev-realtek-hp',
      volume: 92,
      muted: false,
    },
    'Cyberpunk2077.exe': {
      executable: 'Cyberpunk2077.exe',
      preferredDeviceId: 'unassigned',
      volume: 78,
      muted: false,
    },
    'vlc.exe': {
      executable: 'vlc.exe',
      preferredDeviceId: 'dev-usb-speaker',
      volume: 88,
      muted: false,
    },
  },
};

export default function App() {
  const isNativeTauri = isTauriRuntime();
  const [config, setConfig] = useState<SoundFlowConfig>(() =>
    isNativeTauri
      ? {
          ...INITIAL_FALLBACK_CONFIG,
          apps: [],
        }
      : INITIAL_FALLBACK_CONFIG
  );
  const [isPopupOpen, setIsPopupOpen] = useState<boolean>(true);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState<boolean>(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);
  const [trayContextMenu, setTrayContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [audibleMonitor, setAudibleMonitor] = useState<boolean>(false);
  const [physicalSinks, setPhysicalSinks] = useState<MediaDeviceInfo[]>([]);
  const [systemTime, setSystemTime] = useState<string>('');
  const [systemDate, setSystemDate] = useState<string>('');
  const [engineRunning, setEngineRunning] = useState<boolean>(true);

  const [telemetry, setTelemetry] = useState<AudioTelemetryFrame>({
    appLevels: {},
    deviceLevels: {},
    engineLatencyMs: 4.8,
    sampleRateHz: 48000,
    audioContextState: 'suspended',
  });

  const [logs, setLogs] = useState<RoutingLogEntry[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      type: 'system',
      message: 'SoundFlow WASAPI Core Audio router initialized in Windows System Tray',
      detail: '4 active application sessions · 3 connected endpoints',
    },
    {
      id: 'init-2',
      timestamp: new Date().toLocaleTimeString(),
      type: 'route',
      message: 'Restored saved preferences from soundflow-config.json',
      detail: 'Chrome → Speaker · After Effects → Headphone · VLC → Speaker',
    },
  ]);

  const saveTimeoutRef = useRef<number | null>(null);
  const activeSliderIdRef = useRef<string | null>(null);
  const lastUserVolumeChangeRef = useRef<Record<string, number>>({});

  const handleSliderDragStateChange = useCallback((sliderId: string | null) => {
    if (activeSliderIdRef.current && sliderId === null) {
      lastUserVolumeChangeRef.current[activeSliderIdRef.current] = Date.now();
    }
    if (sliderId) {
      lastUserVolumeChangeRef.current[sliderId] = Date.now();
    }
    activeSliderIdRef.current = sliderId;
  }, []);

  const appendLog = useCallback(
    (type: RoutingLogEntry['type'], message: string, detail?: string) => {
      setLogs((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString(),
          type,
          message,
          detail,
        },
        ...prev.slice(0, 29),
      ]);
    },
    []
  );

  // Sync devices and sessions from Tauri 2 Rust Core Audio backend when running natively
  const refreshFromTauriBackend = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const [nativeDevices, nativeSessions] = await Promise.all([
      tauriGetAudioDevices(),
      tauriGetAudioSessions(),
    ]);

    setConfig((prev) => {
      const nextDevices =
        nativeDevices && nativeDevices.length > 0 ? nativeDevices : prev.devices;
      const defaultDev =
        nextDevices.find((d) => d.isDefault) ||
        nextDevices[0] || { id: prev.defaultDeviceId };
      const nextApps =
        nativeSessions !== null
          ? nativeSessions.map((session) => ({
              ...session,
              name:
                session.name && session.name.trim()
                  ? session.name.trim()
                  : 'Unknown App',
            }))
          : prev.apps;

      return {
        ...prev,
        defaultDeviceId: defaultDev.id,
        devices: nextDevices,
        apps: nextApps,
      };
    });
  }, []);

  // Load persisted config on mount (Tauri IPC in desktop runtime, Express API in web preview)
  useEffect(() => {
    let timerId: number | null = null;
    let pollId: number | null = null;
    if (isTauriRuntime()) {
      // Allow the main window to paint its initial UI immediately before querying Windows Core Audio
      timerId = window.setTimeout(() => {
        void refreshFromTauriBackend();
      }, 100);
      // Periodically sync active audio sessions so newly playing or stopped apps update automatically
      pollId = window.setInterval(() => {
        void refreshFromTauriBackend();
      }, 2500);
    } else {
      fetch('/api/config')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.devices) && Array.isArray(data.apps)) {
            setConfig((prev) => ({
              ...prev,
              ...data,
            }));
          }
        })
        .catch(() => {
          // Fallback to local state
        });
    }

    void soundFlowEngine.enumeratePhysicalSinks().then((sinks) => {
      setPhysicalSinks(sinks);
    });

    return () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      if (pollId !== null) {
        window.clearInterval(pollId);
      }
    };
  }, [refreshFromTauriBackend]);

  // Subscribe to native Tauri System Tray events
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlisteners: Array<() => void> = [];
    void subscribeToTauriTrayEvents({
      onTogglePause: () => {
        setConfig((prev) => ({ ...prev, routingActive: !prev.routingActive }));
      },
      onOpenSettings: () => {
        setIsAdvancedSettingsOpen(true);
      },
    }).then((list) => {
      unlisteners = list;
    });

    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  // Debounced persistence to Express backend JSON store + localStorage
  const schedulePersist = useCallback((nextConfig: SoundFlowConfig) => {
    try {
      localStorage.setItem('soundflow_config_v1', JSON.stringify(nextConfig));
    } catch {
      // Ignore storage quota errors
    }

    if (isTauriRuntime()) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      }).catch(() => {
        // Offline resilient
      });
    }, 240);
  }, []);

  const persistConfig = useCallback(
    (nextConfig: SoundFlowConfig) => {
      setConfig(nextConfig);
      schedulePersist(nextConfig);
    },
    [schedulePersist]
  );

  // Keep Web Audio graph synchronized with current state (never stops when popup closes!)
  useEffect(() => {
    if (!engineRunning) {
      soundFlowEngine.syncGraph(config.devices, [], false, config.defaultDeviceId);
      return;
    }
    soundFlowEngine.syncGraph(
      config.devices,
      config.apps,
      config.routingActive,
      config.defaultDeviceId
    );
  }, [config.devices, config.apps, config.routingActive, config.defaultDeviceId, engineRunning]);

  // Subscribe to real-time 65ms Tauri WASAPI IAudioMeterInformation events ("audio_meter_update")
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlistenFn: (() => void) | null = null;
    let active = true;

    void subscribeToTauriAudioMeters((payload) => {
      if (!active) return;
      setTelemetry((prev) => {
        const nextAppLevels: AudioTelemetryFrame['appLevels'] = {};
        const nextDeviceLevels: AudioTelemetryFrame['deviceLevels'] = {};

        for (const [pidKey, rawPeak] of Object.entries(payload.sessionPeaks || {})) {
          const peak = Math.max(0, Math.min(1, Number(rawPeak) || 0));
          const db = peak > 0.0001 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
          const appId = `app-${pidKey}`;
          nextAppLevels[appId] = {
            db,
            peak,
            waveform: [],
            effectiveDeviceId: null,
          };
        }

        for (const [devId, rawPeak] of Object.entries(payload.devicePeaks || {})) {
          const peak = Math.max(0, Math.min(1, Number(rawPeak) || 0));
          const db = peak > 0.0001 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
          nextDeviceLevels[devId] = {
            db,
            peak,
            activeStreamCount: peak > 0.005 ? 1 : 0,
          };
        }

        return {
          ...prev,
          appLevels: nextAppLevels,
          deviceLevels: nextDeviceLevels,
          audioContextState: 'running',
        };
      });

      // Two-Way Volume & Mute Synchronization (Taskbar / Hardware Media Keys <-> SoundFlow UI)
      if (
        payload.deviceVolumes ||
        payload.deviceMutes ||
        payload.sessionVolumes ||
        payload.sessionMutes
      ) {
        const now = Date.now();
        const draggingId = activeSliderIdRef.current;

        setConfig((prev) => {
          let devicesChanged = false;
          const nextDevices = prev.devices.map((dev) => {
            // Do not fight the user while they are actively dragging this slider
            // or within 500ms of a user-initiated volume/mute adjustment
            if (
              draggingId === dev.id ||
              now - (lastUserVolumeChangeRef.current[dev.id] || 0) < 500
            ) {
              return dev;
            }

            const rawScalar = payload.deviceVolumes?.[dev.id];
            const externalVol =
              typeof rawScalar === 'number' && Number.isFinite(rawScalar)
                ? Math.max(0, Math.min(100, Math.round(rawScalar * 100)))
                : dev.masterVolume;

            const rawMute = payload.deviceMutes?.[dev.id];
            const externalMuted =
              typeof rawMute === 'boolean' ? rawMute : dev.muted;

            if (externalVol !== dev.masterVolume || externalMuted !== dev.muted) {
              devicesChanged = true;
              return {
                ...dev,
                masterVolume: externalVol,
                muted: externalMuted,
              };
            }
            return dev;
          });

          let appsChanged = false;
          const nextApps = prev.apps.map((app) => {
            if (
              draggingId === app.id ||
              now - (lastUserVolumeChangeRef.current[app.id] || 0) < 500
            ) {
              return app;
            }

            const pidKey = String(app.pid);
            const rawScalar = payload.sessionVolumes?.[pidKey];
            const externalVol =
              typeof rawScalar === 'number' && Number.isFinite(rawScalar)
                ? Math.max(0, Math.min(100, Math.round(rawScalar * 100)))
                : app.volume;

            const rawMute = payload.sessionMutes?.[pidKey];
            const externalMuted =
              typeof rawMute === 'boolean' ? rawMute : app.muted;

            if (externalVol !== app.volume || externalMuted !== app.muted) {
              appsChanged = true;
              return {
                ...app,
                volume: externalVol,
                muted: externalMuted,
              };
            }
            return app;
          });

          if (!devicesChanged && !appsChanged) {
            return prev;
          }

          return {
            ...prev,
            devices: devicesChanged ? nextDevices : prev.devices,
            apps: appsChanged ? nextApps : prev.apps,
          };
        });
      }
    }).then((unlisten) => {
      if (active && unlisten) {
        unlistenFn = unlisten;
      } else if (unlisten) {
        unlisten();
      }
    });

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);

  // Smooth, low-CPU Web Audio telemetry loop (used in browser preview when not in native Tauri)
  useEffect(() => {
    if (isTauriRuntime()) {
      return;
    }
    if (!engineRunning || (!isPopupOpen && !isAdvancedSettingsOpen)) {
      return;
    }

    const updateTelemetry = () => {
      setTelemetry(soundFlowEngine.getTelemetryFrame());
    };
    updateTelemetry();

    const intervalId = window.setInterval(updateTelemetry, 75);
    return () => window.clearInterval(intervalId);
  }, [engineRunning, isPopupOpen, isAdvancedSettingsOpen]);

  // Windows 11 Taskbar Clock
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setSystemTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
      setSystemDate(
        now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
      );
    };
    updateClock();
    const timer = window.setInterval(updateClock, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const ensureAudioEngineReady = useCallback(() => {
    void soundFlowEngine.init();
  }, []);

  const handleAssignAppDevice = useCallback(
    (appId: string, targetDeviceId: string) => {
      ensureAudioEngineReady();
      setConfig((prev) => {
        const targetApp = prev.apps.find((a) => a.id === appId);
        if (!targetApp) return prev;

        // Invoke Tauri 2 Rust Core Audio command (`set_app_audio_device`) when in native runtime
        void tauriSetAppAudioDevice(targetApp.pid, targetDeviceId);

        const updatedApps = prev.apps.map((app) => {
          if (app.id !== appId) return app;
          return {
            ...app,
            assignedDeviceId: targetDeviceId,
            preferredDeviceId: targetDeviceId,
            isFallbackActive: false,
          };
        });

        const updatedSaved: Record<string, SavedAppPreference> = {
          ...prev.savedPreferences,
          [targetApp.executable]: {
            executable: targetApp.executable,
            preferredDeviceId: targetDeviceId,
            volume: targetApp.volume,
            muted: targetApp.muted,
          },
        };

        const devName =
          targetDeviceId === 'unassigned'
            ? 'Not Assigned'
            : targetDeviceId === 'default'
            ? 'Default Output'
            : prev.devices.find((d) => d.id === targetDeviceId)?.name || targetDeviceId;

        appendLog(
          'route',
          `Routed ${targetApp.name} (${targetApp.executable}) → ${devName}`,
          `Live WASAPI stream switched without restarting process (PID ${targetApp.pid})`
        );

        const next = {
          ...prev,
          apps: updatedApps,
          savedPreferences: updatedSaved,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, appendLog, schedulePersist]
  );

  const handleChangeAppVolume = useCallback(
    (appId: string, volume: number) => {
      ensureAudioEngineReady();
      lastUserVolumeChangeRef.current[appId] = Date.now();
      const clamped = Math.max(0, Math.min(100, volume));
      const isMuted = clamped === 0;

      // Fast direct Web Audio gain update for 0ms response
      soundFlowEngine.setAppVolumeFast(appId, clamped, isMuted);

      setConfig((prev) => {
        const targetApp = prev.apps.find((a) => a.id === appId);
        if (!targetApp) return prev;

        // Invoke Tauri 2 Rust Core Audio command (`set_app_volume`) when in native runtime
        void tauriSetAppVolume(targetApp.pid, clamped);

        const updatedApps = prev.apps.map((app) =>
          app.id === appId ? { ...app, volume: clamped, muted: isMuted } : app
        );

        const updatedSaved: Record<string, SavedAppPreference> = {
          ...prev.savedPreferences,
          [targetApp.executable]: {
            executable: targetApp.executable,
            preferredDeviceId: targetApp.preferredDeviceId,
            volume: clamped,
            muted: isMuted,
          },
        };

        const next = {
          ...prev,
          apps: updatedApps,
          savedPreferences: updatedSaved,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, schedulePersist]
  );

  const handleToggleAppMute = useCallback(
    (appId: string) => {
      ensureAudioEngineReady();
      lastUserVolumeChangeRef.current[appId] = Date.now();
      setConfig((prev) => {
        const targetApp = prev.apps.find((a) => a.id === appId);
        if (!targetApp) return prev;
        const nextMuted = !targetApp.muted;

        soundFlowEngine.setAppVolumeFast(appId, targetApp.volume, nextMuted);
        void tauriSetAppMute(targetApp.pid, nextMuted);

        const updatedApps = prev.apps.map((app) =>
          app.id === appId ? { ...app, muted: nextMuted } : app
        );

        appendLog(
          'route',
          `${nextMuted ? 'Muted' : 'Unmuted'} ${targetApp.name}`,
          `Session PID ${targetApp.pid}`
        );

        const next = {
          ...prev,
          apps: updatedApps,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, appendLog, schedulePersist]
  );

  const handleSelectDefaultDevice = useCallback(
    (deviceId: string) => {
      ensureAudioEngineReady();
      void tauriSetDefaultAudioDevice(deviceId);

      setConfig((prev) => {
        const targetDev = prev.devices.find((d) => d.id === deviceId);
        if (!targetDev || targetDev.status !== 'connected') return prev;

        const updatedDevices = prev.devices.map((d) => ({
          ...d,
          isDefault: d.id === deviceId,
        }));

        appendLog(
          'system',
          `Default Output changed to ${targetDev.name} (${targetDev.driver})`,
          'Applications set to Default or Fallback now route here'
        );

        const next = {
          ...prev,
          defaultDeviceId: deviceId,
          devices: updatedDevices,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, appendLog, schedulePersist]
  );

  const handleChangeDeviceVolume = useCallback(
    (deviceId: string, volume: number) => {
      ensureAudioEngineReady();
      lastUserVolumeChangeRef.current[deviceId] = Date.now();
      const clamped = Math.max(0, Math.min(100, volume));
      const isMuted = clamped === 0;

      // Fast direct Web Audio gain update for 0ms response in browser preview
      soundFlowEngine.setDeviceVolumeFast(deviceId, clamped, isMuted);

      // Invoke Tauri 2 Rust Core Audio command (`set_device_volume`) when in native runtime
      void tauriSetDeviceVolume(deviceId, clamped);

      setConfig((prev) => {
        const updatedDevices = prev.devices.map((d) =>
          d.id === deviceId ? { ...d, masterVolume: clamped, muted: isMuted } : d
        );
        const next = {
          ...prev,
          devices: updatedDevices,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, schedulePersist]
  );

  const handleToggleDeviceMute = useCallback(
    (deviceId: string) => {
      ensureAudioEngineReady();
      lastUserVolumeChangeRef.current[deviceId] = Date.now();
      setConfig((prev) => {
        const targetDev = prev.devices.find((d) => d.id === deviceId);
        if (!targetDev) return prev;
        const nextMuted = !targetDev.muted;

        soundFlowEngine.setDeviceVolumeFast(deviceId, targetDev.masterVolume, nextMuted);
        void tauriSetDeviceMute(deviceId, nextMuted);

        const updatedDevices = prev.devices.map((d) =>
          d.id === deviceId ? { ...d, muted: nextMuted } : d
        );

        appendLog(
          'system',
          `${nextMuted ? 'Muted' : 'Unmuted'} device ${targetDev.name} (${targetDev.driver})`
        );

        const next = {
          ...prev,
          devices: updatedDevices,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, appendLog, schedulePersist]
  );

  const handleToggleDeviceConnection = useCallback(
    (deviceId: string) => {
      ensureAudioEngineReady();
      setConfig((prev) => {
        const targetDevice = prev.devices.find((d) => d.id === deviceId);
        if (!targetDevice) return prev;

        const nextStatus: DeviceConnectionStatus =
          targetDevice.status === 'connected' ? 'disconnected' : 'connected';

        const connectedCount = prev.devices.filter((d) => d.status === 'connected').length;
        if (nextStatus === 'disconnected' && connectedCount <= 1) {
          appendLog(
            'hotplug',
            `Cannot unplug ${targetDevice.name}: Windows requires at least one active audio output endpoint`
          );
          return prev;
        }

        const updatedDevices = prev.devices.map((d) =>
          d.id === deviceId ? { ...d, status: nextStatus } : d
        );

        let nextDefaultId = prev.defaultDeviceId;
        if (nextStatus === 'disconnected' && prev.defaultDeviceId === deviceId) {
          const fallbackDev = updatedDevices.find((d) => d.status === 'connected');
          if (fallbackDev) {
            nextDefaultId = fallbackDev.id;
          }
        }

        const finalDevices = updatedDevices.map((d) => ({
          ...d,
          isDefault: d.id === nextDefaultId,
        }));

        const fallbackDeviceName =
          finalDevices.find((d) => d.id === nextDefaultId)?.name || 'Default Output';

        let affectedCount = 0;
        const updatedApps = prev.apps.map((app) => {
          if (nextStatus === 'disconnected') {
            if (app.assignedDeviceId === deviceId) {
              affectedCount++;
              return {
                ...app,
                assignedDeviceId: nextDefaultId,
                preferredDeviceId: deviceId,
                isFallbackActive: true,
              };
            }
            return app;
          } else {
            const savedPref = prev.savedPreferences[app.executable];
            const shouldRestore =
              prev.autoRestoreOnReconnect &&
              (app.preferredDeviceId === deviceId ||
                savedPref?.preferredDeviceId === deviceId);

            if (shouldRestore) {
              affectedCount++;
              return {
                ...app,
                assignedDeviceId: deviceId,
                preferredDeviceId: deviceId,
                isFallbackActive: false,
              };
            }
            return app;
          }
        });

        if (nextStatus === 'disconnected') {
          appendLog(
            'hotplug',
            `Device Disconnected: ${targetDevice.name} — ${targetDevice.driver}`,
            affectedCount > 0
              ? `Automatically failed over ${affectedCount} application(s) to ${fallbackDeviceName}`
              : 'No applications were bound to this endpoint'
          );
        } else {
          appendLog(
            'recovery',
            `Device Reconnected: ${targetDevice.name} — ${targetDevice.driver}`,
            affectedCount > 0
              ? `Restored saved routing preferences for ${affectedCount} application(s) back to ${targetDevice.name}`
              : 'Endpoint ready for application assignment'
          );
        }

        const next = {
          ...prev,
          defaultDeviceId: nextDefaultId,
          devices: finalDevices,
          apps: updatedApps,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, appendLog, schedulePersist]
  );

  const handleToggleLaunchApp = useCallback(
    (template: LaunchableProcessTemplate) => {
      ensureAudioEngineReady();
      setConfig((prev) => {
        const existing = prev.apps.find((a) => a.executable === template.executable);

        if (existing) {
          const updatedApps = prev.apps.filter((a) => a.executable !== template.executable);
          appendLog(
            'process',
            `Process Terminated: ${template.name} (${template.executable})`,
            `Released WASAPI session PID ${existing.pid} · Routing preference preserved`
          );
          const next = {
            ...prev,
            apps: updatedApps,
          };
          schedulePersist(next);
          return next;
        } else {
          const saved = prev.savedPreferences[template.executable];
          const preferredId = saved ? saved.preferredDeviceId : 'default';
          const isPreferredOnline =
            preferredId === 'default' ||
            preferredId === 'unassigned' ||
            prev.devices.some((d) => d.id === preferredId && d.status === 'connected');

          const assignedId = isPreferredOnline ? preferredId : prev.defaultDeviceId;

          const newApp: AppAudioSession = {
            id: `app-${template.executable.toLowerCase().replace('.', '-')}-${Date.now()}`,
            pid: template.defaultPid + Math.floor(Math.random() * 900),
            executable: template.executable,
            name: template.name,
            windowTitle: template.windowTitle,
            iconType: template.iconType,
            assignedDeviceId: assignedId,
            preferredDeviceId: preferredId,
            volume: saved ? saved.volume : 85,
            muted: saved ? saved.muted : false,
            isPlaying: true,
            isFallbackActive: !isPreferredOnline,
          };

          const devLabel =
            assignedId === 'default'
              ? 'Default Output'
              : assignedId === 'unassigned'
              ? 'Not Assigned'
              : prev.devices.find((d) => d.id === assignedId)?.name || 'Default Output';

          appendLog(
            'process',
            `Detected New Application: ${template.name} (${template.executable})`,
            saved
              ? `Automatically applied saved route → ${devLabel} (${newApp.volume}%)`
              : `Assigned to ${devLabel}`
          );

          const next = {
            ...prev,
            apps: [...prev.apps, newApp],
          };
          schedulePersist(next);
          return next;
        }
      });
    },
    [ensureAudioEngineReady, appendLog, schedulePersist]
  );

  const handleToggleAppPlayback = useCallback(
    (appId: string) => {
      ensureAudioEngineReady();
      setConfig((prev) => {
        const updatedApps = prev.apps.map((app) =>
          app.id === appId ? { ...app, isPlaying: !app.isPlaying } : app
        );
        const next = {
          ...prev,
          apps: updatedApps,
        };
        schedulePersist(next);
        return next;
      });
    },
    [ensureAudioEngineReady, schedulePersist]
  );

  const handleToggleAudibleMonitor = useCallback(() => {
    const next = !audibleMonitor;
    setAudibleMonitor(next);
    soundFlowEngine.setAudibleMonitor(next);
    appendLog(
      'system',
      next
        ? 'Enabled live Web Audio speaker monitoring for all routed streams'
        : 'Muted browser speaker output (WASAPI DSP & metering remain active)'
    );
  }, [audibleMonitor, appendLog]);

  const handleResetSavedPreferences = useCallback(() => {
    if (isTauriRuntime()) {
      void refreshFromTauriBackend();
      return;
    }
    fetch('/api/config/reset', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((resetData) => {
        if (resetData) {
          setConfig(resetData);
          appendLog('system', 'Reset all routing preferences to factory defaults');
        }
      })
      .catch(() => {
        setConfig(INITIAL_FALLBACK_CONFIG);
      });
  }, [appendLog, refreshFromTauriBackend]);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const key = e.key.toUpperCase();
      if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(key) && key.length === 1) {
        parts.push(key);
      }
      const combo = parts.join('+');
      if (!combo) return;

      if (combo === config.shortcuts.togglePopup) {
        e.preventDefault();
        setIsPopupOpen((prev) => !prev);
        appendLog('system', `Global Shortcut [${combo}]: Toggled SoundFlow popup`);
      } else if (combo === config.shortcuts.muteActiveApp && config.apps.length > 0) {
        e.preventDefault();
        handleToggleAppMute(config.apps[0].id);
      } else if (combo === config.shortcuts.cycleDefaultDevice) {
        e.preventDefault();
        const connected = config.devices.filter((d) => d.status === 'connected');
        if (connected.length > 1) {
          const idx = connected.findIndex((d) => d.id === config.defaultDeviceId);
          const nextDev = connected[(idx + 1) % connected.length];
          handleSelectDefaultDevice(nextDev.id);
        }
      } else if (combo === config.shortcuts.pauseResumeRouting) {
        e.preventDefault();
        persistConfig({
          ...config,
          routingActive: !config.routingActive,
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [config, appendLog, handleToggleAppMute, handleSelectDefaultDevice, persistConfig]);

  const connectedDevices = config.devices.filter((d) => d.status === 'connected');

  const handleRefreshSessionsAndDevices = useCallback(() => {
    if (isTauriRuntime()) {
      void refreshFromTauriBackend();
    } else {
      appendLog(
        'process',
        `Refreshed Windows audio sessions (${config.apps.length} active processes, ${connectedDevices.length} connected endpoints)`
      );
    }
  }, [refreshFromTauriBackend, appendLog, config.apps.length, connectedDevices.length]);

  // If running inside the native 400x560 Tauri desktop window, render the popup directly
  if (isNativeTauri) {
    return (
      <div className="w-screen h-screen overflow-hidden bg-[#F5F8FF] text-[#172033] flex items-center justify-center">
        <SoundFlowPopup
          isOpen={true}
          routingActive={config.routingActive}
          onToggleRoutingActive={() =>
            persistConfig({ ...config, routingActive: !config.routingActive })
          }
          devices={config.devices}
          defaultDeviceId={config.defaultDeviceId}
          onSelectDefaultDevice={handleSelectDefaultDevice}
          onChangeDeviceVolume={handleChangeDeviceVolume}
          onToggleDeviceMute={handleToggleDeviceMute}
          apps={config.apps}
          onAssignAppDevice={handleAssignAppDevice}
          onChangeAppVolume={handleChangeAppVolume}
          onToggleAppMute={handleToggleAppMute}
          onRefreshApps={handleRefreshSessionsAndDevices}
          onOpenAdvancedSettings={() => setIsAdvancedSettingsOpen(true)}
          telemetry={telemetry}
          onSliderDragStateChange={handleSliderDragStateChange}
        />

        <AdvancedSettingsModal
          isOpen={isAdvancedSettingsOpen}
          onClose={() => setIsAdvancedSettingsOpen(false)}
          devices={config.devices}
          defaultDeviceId={config.defaultDeviceId}
          onSelectDefaultDevice={handleSelectDefaultDevice}
          onToggleDeviceConnection={handleToggleDeviceConnection}
          apps={config.apps}
          launchableApps={LAUNCHABLE_APPS}
          savedPreferences={config.savedPreferences}
          onToggleLaunchApp={handleToggleLaunchApp}
          onToggleAppPlayback={handleToggleAppPlayback}
          launchAtStartup={config.launchAtStartup}
          onToggleLaunchAtStartup={() =>
            persistConfig({ ...config, launchAtStartup: !config.launchAtStartup })
          }
          minimizeToTray={config.minimizeToTray}
          onToggleMinimizeToTray={() =>
            persistConfig({ ...config, minimizeToTray: !config.minimizeToTray })
          }
          autoRestoreOnReconnect={config.autoRestoreOnReconnect}
          onToggleAutoRestore={() =>
            persistConfig({
              ...config,
              autoRestoreOnReconnect: !config.autoRestoreOnReconnect,
            })
          }
          shortcuts={config.shortcuts}
          onUpdateShortcut={(key: keyof GlobalShortcutsConfig, value: string) =>
            persistConfig({
              ...config,
              shortcuts: { ...config.shortcuts, [key]: value },
            })
          }
          onResetSavedPreferences={handleResetSavedPreferences}
          physicalSinks={physicalSinks}
          onBindPhysicalSink={(deviceId, sinkId) => {
            void soundFlowEngine.bindHardwareSink(deviceId, sinkId);
          }}
          audibleMonitor={audibleMonitor}
          onToggleAudibleMonitor={handleToggleAudibleMonitor}
          telemetry={telemetry}
          logs={logs}
          onOpenTauriCode={() => {
            setIsAdvancedSettingsOpen(false);
            setIsCodeModalOpen(true);
          }}
        />
      </div>
    );
  }

  return (
    <div
      onClick={() => {
        // Clicking outside closes the popup & context menu without stopping background audio routing!
        if (isPopupOpen) {
          setIsPopupOpen(false);
        }
        if (trayContextMenu) {
          setTrayContextMenu(null);
        }
      }}
      className="relative w-screen h-screen overflow-hidden bg-[#F5F8FF] text-[#172033] flex flex-col justify-end select-none"
      style={{
        backgroundImage:
          'radial-gradient(circle at 62% 38%, rgba(112, 165, 255, 0.24) 0%, rgba(52, 120, 246, 0.10) 35%, rgba(245, 248, 255, 1) 75%)',
      }}
    >
      {/* Subtle Ambient Light Orbs behind the Frosted Glass Popup */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full blur-3xl opacity-45"
        style={{
          background: 'radial-gradient(circle, #70A5FF 0%, rgba(52, 120, 246, 0) 70%)',
        }}
      />

      {/* Main Popup Viewport — Compact 400 × 560 px System Tray Popup */}
      <main className="flex-1 min-h-0 w-full flex items-center justify-center p-3 relative z-20">
        {isPopupOpen ? (
          <SoundFlowPopup
            isOpen={isPopupOpen}
            routingActive={config.routingActive}
            onToggleRoutingActive={() => {
              const next = !config.routingActive;
              appendLog(
                'system',
                next ? 'Resumed live WASAPI audio routing' : 'Paused live WASAPI audio routing'
              );
              persistConfig({ ...config, routingActive: next });
            }}
            devices={config.devices}
            defaultDeviceId={config.defaultDeviceId}
            onSelectDefaultDevice={handleSelectDefaultDevice}
            onChangeDeviceVolume={handleChangeDeviceVolume}
            onToggleDeviceMute={handleToggleDeviceMute}
            apps={config.apps}
            onAssignAppDevice={handleAssignAppDevice}
            onChangeAppVolume={handleChangeAppVolume}
            onToggleAppMute={handleToggleAppMute}
            onRefreshApps={handleRefreshSessionsAndDevices}
            onOpenAdvancedSettings={() => setIsAdvancedSettingsOpen(true)}
            telemetry={telemetry}
            onSliderDragStateChange={handleSliderDragStateChange}
          />
        ) : (
          /* Minimal Frosted Glass Minimized Card when user clicks outside to close popup */
          <div
            onClick={(e) => {
              e.stopPropagation();
              setIsPopupOpen(true);
            }}
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.72)',
              borderColor: 'rgba(255, 255, 255, 0.85)',
            }}
            className="sf-animate-popup px-4 py-3 rounded-[16px] backdrop-blur-2xl border shadow-[0_12px_32px_rgba(23,32,51,0.08)] flex items-center gap-3 cursor-pointer hover:bg-white/85 transition-all"
          >
            <SoundFlowBrandIcon size={24} />
            <div className="text-xs">
              <div className="font-display font-semibold text-[#172033]">
                SoundFlow is running in the Windows System Tray
              </div>
              <div className="text-[11px] text-[#758198]">
                Background audio routing remains active · Click here or the tray icon below to reopen
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Native Windows System Tray Right-Click Context Menu (Frosted White Glass) */}
      {trayContextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            right: Math.max(16, window.innerWidth - trayContextMenu.x),
            bottom: 52,
            backgroundColor: 'rgba(255, 255, 255, 0.88)',
            borderColor: 'rgba(255, 255, 255, 0.92)',
          }}
          className="sf-animate-dropdown-up fixed z-50 w-48 rounded-[14px] backdrop-blur-2xl border shadow-[0_14px_36px_rgba(23,32,51,0.16),0_0_0_1px_rgba(23,32,51,0.05)] py-1.5 text-xs text-[#172033]"
          role="menu"
          aria-label="SoundFlow System Tray Context Menu"
        >
          <div className="px-3 py-1.5 border-b border-[#172033]/[0.06] flex items-center gap-2">
            <SoundFlowBrandIcon size={15} />
            <span className="font-display font-semibold text-xs text-[#172033]">
              SoundFlow
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsPopupOpen(true);
              setTrayContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F5F8FF] transition-colors cursor-pointer"
            role="menuitem"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#3478F6]" />
            <span>Open SoundFlow</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !config.routingActive;
              persistConfig({ ...config, routingActive: next });
              appendLog(
                'system',
                next
                  ? 'Resumed audio routing from System Tray context menu'
                  : 'Paused audio routing from System Tray context menu'
              );
              setTrayContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F5F8FF] transition-colors cursor-pointer"
            role="menuitem"
          >
            {config.routingActive ? (
              <>
                <PauseCircle className="w-3.5 h-3.5 text-amber-500" />
                <span>Pause Routing</span>
              </>
            ) : (
              <>
                <PlayCircle className="w-3.5 h-3.5 text-[#16A36A]" />
                <span>Resume Routing</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setIsAdvancedSettingsOpen(true);
              setTrayContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F5F8FF] transition-colors cursor-pointer"
            role="menuitem"
          >
            <Sliders className="w-3.5 h-3.5 text-[#758198]" />
            <span>Settings</span>
          </button>

          <div className="my-1 border-t border-[#172033]/[0.06]" />

          <button
            type="button"
            onClick={() => {
              setTrayContextMenu(null);
              if (config.minimizeToTray) {
                setIsPopupOpen(false);
                appendLog(
                  'system',
                  'SoundFlow minimized to System Tray (audio engine remains active)'
                );
              } else {
                const nextState = !engineRunning;
                setEngineRunning(nextState);
                setIsPopupOpen(false);
              }
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            role="menuitem"
          >
            <Power className="w-3.5 h-3.5" />
            <span>Exit</span>
          </button>
        </div>
      )}

      {/* Compact Windows 11 Fluent Light Glass Taskbar & System Tray Strip */}
      <footer
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.72)',
          borderColor: 'rgba(255, 255, 255, 0.85)',
        }}
        className="h-11 px-4 border-t backdrop-blur-2xl shadow-[0_-4px_20px_rgba(23,32,51,0.04)] flex items-center justify-between z-40 shrink-0"
      >
        {/* Left: Windows Start & Active Apps */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsPopupOpen((prev) => !prev)}
            title="Toggle SoundFlow Popup"
            className="p-1.5 rounded-[8px] hover:bg-white/80 transition-colors cursor-pointer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="8" height="8" rx="1.5" fill="#3478F6" />
              <rect x="13" y="3" width="8" height="8" rx="1.5" fill="#70A5FF" />
              <rect x="3" y="13" width="8" height="8" rx="1.5" fill="#70A5FF" />
              <rect x="13" y="13" width="8" height="8" rx="1.5" fill="#3478F6" />
            </svg>
          </button>

          <div className="h-3.5 w-[1px] bg-[#172033]/10 mx-1" />

          <div className="flex items-center gap-1">
            {config.apps.map((app) => (
              <button
                key={app.id}
                type="button"
                onClick={() => setIsPopupOpen(true)}
                title={app.name}
                className="p-1 rounded-[8px] hover:bg-white/80 transition-colors cursor-pointer"
              >
                <ApplicationIcon type={app.iconType} className="w-5 h-5" />
              </button>
            ))}
          </div>
        </div>

        {/* Right: Windows System Tray Notification Area */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              ensureAudioEngineReady();
              setTrayContextMenu(null);
              setIsPopupOpen((prev) => !prev);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTrayContextMenu({ x: e.clientX, y: e.clientY });
            }}
            title="SoundFlow — Left-click to toggle popup · Right-click for menu"
            className={`px-2.5 py-1 rounded-[10px] flex items-center gap-1.5 border transition-all cursor-pointer shadow-2xs ${
              isPopupOpen
                ? 'bg-white border-[#3478F6]/50'
                : 'bg-white/65 hover:bg-white border-white/85'
            }`}
            aria-label="SoundFlow System Tray Icon"
          >
            <SoundFlowBrandIcon size={16} />
            <span className="text-[11.5px] font-display font-semibold text-[#172033]">
              SoundFlow
            </span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                config.routingActive ? 'bg-[#16A36A]' : 'bg-amber-500'
              }`}
            />
          </button>

          <div
            onClick={() => setIsAdvancedSettingsOpen(true)}
            title="Open Advanced Settings"
            className="hidden sm:flex items-center gap-2 px-2 py-1 rounded-[8px] hover:bg-white/80 text-[#758198] transition-colors cursor-pointer"
          >
            <Wifi className="w-3.5 h-3.5" />
            {audibleMonitor ? (
              <Volume2 className="w-3.5 h-3.5 text-[#16A36A]" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <BatteryCharging className="w-3.5 h-3.5" />
          </div>

          <div className="px-1.5 text-right leading-tight">
            <div className="text-[10.5px] font-mono tabular-nums text-[#172033] font-medium">
              {systemTime || '09:41 AM'}
            </div>
            <div className="text-[9.5px] font-mono tabular-nums text-[#758198]">
              {systemDate || 'Nov 5, 2026'}
            </div>
          </div>
        </div>
      </footer>

      {/* Separate Advanced Settings Page / Modal */}
      <AdvancedSettingsModal
        isOpen={isAdvancedSettingsOpen}
        onClose={() => setIsAdvancedSettingsOpen(false)}
        devices={config.devices}
        defaultDeviceId={config.defaultDeviceId}
        onSelectDefaultDevice={handleSelectDefaultDevice}
        onToggleDeviceConnection={handleToggleDeviceConnection}
        apps={config.apps}
        launchableApps={LAUNCHABLE_APPS}
        savedPreferences={config.savedPreferences}
        onToggleLaunchApp={handleToggleLaunchApp}
        onToggleAppPlayback={handleToggleAppPlayback}
        launchAtStartup={config.launchAtStartup}
        onToggleLaunchAtStartup={() => {
          const next = !config.launchAtStartup;
          appendLog(
            'system',
            next
              ? 'Enabled Windows startup launch (HKCU\\...\\Run\\SoundFlow)'
              : 'Disabled Windows startup launch'
          );
          persistConfig({ ...config, launchAtStartup: next });
        }}
        minimizeToTray={config.minimizeToTray}
        onToggleMinimizeToTray={() =>
          persistConfig({ ...config, minimizeToTray: !config.minimizeToTray })
        }
        autoRestoreOnReconnect={config.autoRestoreOnReconnect}
        onToggleAutoRestore={() =>
          persistConfig({
            ...config,
            autoRestoreOnReconnect: !config.autoRestoreOnReconnect,
          })
        }
        shortcuts={config.shortcuts}
        onUpdateShortcut={(key: keyof GlobalShortcutsConfig, value: string) => {
          appendLog('system', `Updated global shortcut [${key}] → ${value}`);
          persistConfig({
            ...config,
            shortcuts: { ...config.shortcuts, [key]: value },
          });
        }}
        onResetSavedPreferences={handleResetSavedPreferences}
        physicalSinks={physicalSinks}
        onBindPhysicalSink={(deviceId, sinkId) => {
          void soundFlowEngine.bindHardwareSink(deviceId, sinkId);
          const updatedDevices = config.devices.map((d) =>
            d.id === deviceId ? { ...d, hardwareSinkId: sinkId } : d
          );
          persistConfig({ ...config, devices: updatedDevices });
        }}
        audibleMonitor={audibleMonitor}
        onToggleAudibleMonitor={handleToggleAudibleMonitor}
        telemetry={telemetry}
        logs={logs}
        onOpenTauriCode={() => {
          setIsAdvancedSettingsOpen(false);
          setIsCodeModalOpen(true);
        }}
      />

      {/* Tauri 2 + Rust WASAPI Source Code Modal */}
      <TauriCodeModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
        config={config}
      />
    </div>
  );
}
