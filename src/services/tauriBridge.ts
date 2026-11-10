import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { AppAudioSession, AudioOutputDevice } from '../types/soundflow';

export interface AudioMeterUpdatePayload {
  sessionPeaks: Record<string, number>;
  devicePeaks: Record<string, number>;
  deviceVolumes?: Record<string, number>;
  deviceMutes?: Record<string, boolean>;
  sessionVolumes?: Record<string, number>;
  sessionMutes?: Record<string, boolean>;
}

/**
 * Detects whether SoundFlow is currently running inside the native Tauri 2 Windows runtime.
 */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

/**
 * Fetches physical playback audio devices from Rust Core Audio (`IMMDeviceEnumerator`).
 */
export async function tauriGetAudioDevices(): Promise<AudioOutputDevice[] | null> {
  if (!isTauriRuntime()) return null;
  try {
    const devices = await invoke<AudioOutputDevice[]>('get_audio_devices');
    return Array.isArray(devices) ? devices : null;
  } catch (err) {
    console.warn('Tauri get_audio_devices error:', err);
    return null;
  }
}

/**
 * Fetches active audio sessions & running applications from Rust Core Audio (`IAudioSessionManager2`).
 */
export async function tauriGetAudioSessions(): Promise<AppAudioSession[] | null> {
  if (!isTauriRuntime()) return null;
  try {
    const sessions = await invoke<AppAudioSession[]>('get_audio_sessions');
    return Array.isArray(sessions) ? sessions : null;
  } catch (err) {
    console.warn('Tauri get_audio_sessions error:', err);
    return null;
  }
}

/**
 * Routes a specific Windows process (PID) to a physical audio output endpoint
 * via Windows `IAudioPolicyConfig::SetPersistedDefaultAudioEndpoint`.
 */
export async function tauriSetAppAudioDevice(
  pid: number,
  deviceId: string
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('set_app_audio_device', {
      pid,
      deviceId,
    });
    return true;
  } catch (err) {
    console.warn('Tauri set_app_audio_device error:', err);
    return false;
  }
}

/**
 * Sets per-application volume (`0` to `100`) via Windows `ISimpleAudioVolume::SetMasterVolume`.
 */
export async function tauriSetAppVolume(
  pid: number,
  volume: number
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('set_app_volume', {
      pid,
      volume: volume / 100,
    });
    return true;
  } catch (err) {
    console.warn('Tauri set_app_volume error:', err);
    return false;
  }
}

/**
 * Mutes or unmutes an application session via Windows `ISimpleAudioVolume::SetMute`.
 */
export async function tauriSetAppMute(
  pid: number,
  muted: boolean
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('set_app_mute', {
      pid,
      muted,
    });
    return true;
  } catch (err) {
    console.warn('Tauri set_app_mute error:', err);
    return false;
  }
}

/**
 * Sets the system-wide default playback audio endpoint via `IPolicyConfig::SetDefaultEndpoint`.
 */
export async function tauriSetDefaultAudioDevice(
  deviceId: string
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('set_default_audio_device', {
      deviceId,
    });
    return true;
  } catch (err) {
    console.warn('Tauri set_default_audio_device error:', err);
    return false;
  }
}

/**
 * Sets master volume (`0` to `100`) for a physical audio endpoint via `IAudioEndpointVolume::SetMasterVolumeLevelScalar`.
 */
export async function tauriSetDeviceVolume(
  deviceId: string,
  volume: number
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('set_device_volume', {
      deviceId,
      volume: volume / 100,
    });
    return true;
  } catch (err) {
    console.warn('Tauri set_device_volume error:', err);
    return false;
  }
}

/**
 * Mutes or unmutes a physical audio endpoint via `IAudioEndpointVolume::SetMute`.
 */
export async function tauriSetDeviceMute(
  deviceId: string,
  muted: boolean
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    await invoke('set_device_mute', {
      deviceId,
      muted,
    });
    return true;
  } catch (err) {
    console.warn('Tauri set_device_mute error:', err);
    return false;
  }
}

/**
 * Subscribes to real-time 65ms `audio_meter_update` events emitted by the Rust Core Audio background thread.
 */
export async function subscribeToTauriAudioMeters(
  onUpdate: (payload: AudioMeterUpdatePayload) => void
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await listen<AudioMeterUpdatePayload>('audio_meter_update', (event) => {
      if (event && event.payload) {
        onUpdate(event.payload);
      }
    });
  } catch (err) {
    console.warn('Failed to subscribe to audio_meter_update:', err);
    return null;
  }
}

/**
 * Subscribes to native Windows System Tray menu events emitted from `src-tauri/src/main.rs`.
 */
export async function subscribeToTauriTrayEvents(handlers: {
  onTogglePause: () => void;
  onOpenSettings: () => void;
}): Promise<UnlistenFn[]> {
  if (!isTauriRuntime()) return [];
  const unlisteners: UnlistenFn[] = [];
  try {
    const u1 = await listen('tray://toggle-pause', () => {
      handlers.onTogglePause();
    });
    const u2 = await listen('tray://open-settings', () => {
      handlers.onOpenSettings();
    });
    unlisteners.push(u1, u2);
  } catch (err) {
    console.warn('Failed to register Tauri tray listeners:', err);
  }
  return unlisteners;
}
