export type DeviceConnectionStatus = 'connected' | 'disconnected';

export type DeviceFormFactor = 'headphones' | 'speakers' | 'monitor' | 'dac';

export interface AudioOutputDevice {
  id: string;
  name: string;        // e.g., "Headphone", "Speaker"
  driver: string;      // e.g., "Realtek Audio", "USB Speaker"
  status: DeviceConnectionStatus;
  formFactor: DeviceFormFactor;
  isDefault: boolean;
  sampleRate: string;  // e.g., "48.0 kHz"
  bitDepth: string;    // e.g., "24-bit"
  hardwareSinkId?: string; // Optional physical browser audiooutput deviceId for setSinkId
  masterVolume: number; // 0 - 100
  muted: boolean;
}

export type AppIconType = 'chrome' | 'after-effects' | 'game' | 'vlc' | 'spotify' | 'discord' | 'obs';

export interface AppAudioSession {
  id: string;
  pid: number;
  executable: string;
  name: string;
  windowTitle: string;
  iconType: AppIconType;
  /**
   * Current active output assignment:
   * - device.id (e.g., 'dev-realtek-hp', 'dev-usb-speaker')
   * - 'default' (follows current system Default Output)
   * - 'unassigned' (Not Assigned / unrouted)
   */
  assignedDeviceId: string;
  /**
   * Remembered preferred device ID persisted across device disconnections.
   * When a disconnected device reconnects, SoundFlow automatically restores this route.
   */
  preferredDeviceId: string;
  volume: number;      // 0 - 100
  muted: boolean;
  isPlaying: boolean;
  isFallbackActive?: boolean; // True when preferredDeviceId is disconnected and stream fell back to Default Output
}

export interface SavedAppPreference {
  executable: string;
  preferredDeviceId: string;
  volume: number;
  muted: boolean;
}

export interface GlobalShortcutsConfig {
  togglePopup: string;
  muteActiveApp: string;
  cycleDefaultDevice: string;
  pauseResumeRouting: string;
}

export interface SoundFlowConfig {
  routingActive: boolean;
  defaultDeviceId: string;
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  autoRestoreOnReconnect: boolean;
  audioEngineInitialized: boolean;
  shortcuts: GlobalShortcutsConfig;
  devices: AudioOutputDevice[];
  apps: AppAudioSession[];
  savedPreferences: Record<string, SavedAppPreference>;
}

export interface AudioTelemetryFrame {
  appLevels: Record<string, {
    db: number;          // -60 to 0 dBFS
    peak: number;        // 0 to 1 normalized
    waveform: number[];  // 16-point normalized time-domain sample
    effectiveDeviceId: string | null;
  }>;
  deviceLevels: Record<string, {
    db: number;
    peak: number;
    activeStreamCount: number;
  }>;
  engineLatencyMs: number;
  sampleRateHz: number;
  audioContextState: 'suspended' | 'running' | 'closed' | 'interrupted';
}

export interface RoutingLogEntry {
  id: string;
  timestamp: string;
  type: 'route' | 'hotplug' | 'recovery' | 'process' | 'system';
  message: string;
  detail?: string;
}
