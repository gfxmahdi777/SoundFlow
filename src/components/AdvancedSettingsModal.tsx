import React, { useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauriRuntime } from '../services/tauriBridge';
import {
  AppAudioSession,
  AppIconType,
  AudioOutputDevice,
  AudioTelemetryFrame,
  GlobalShortcutsConfig,
  RoutingLogEntry,
  SavedAppPreference,
} from '../types/soundflow';
import {
  ApplicationIcon,
  DeviceEndpointIcon,
  SoundFlowBrandIcon,
} from './AppIcons';
import {
  X,
  Sliders,
  Unplug,
  Plug,
  Play,
  Square,
  Plus,
  Trash2,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Keyboard,
  Volume2,
  VolumeX,
  Code2,
  RefreshCw,
  Download,
} from 'lucide-react';

export interface LaunchableProcessTemplate {
  executable: string;
  name: string;
  windowTitle: string;
  iconType: AppIconType;
  defaultPid: number;
}

interface AdvancedSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: AudioOutputDevice[];
  defaultDeviceId: string;
  onSelectDefaultDevice: (deviceId: string) => void;
  onToggleDeviceConnection: (deviceId: string) => void;
  apps: AppAudioSession[];
  launchableApps: LaunchableProcessTemplate[];
  savedPreferences: Record<string, SavedAppPreference>;
  onToggleLaunchApp: (template: LaunchableProcessTemplate) => void;
  onToggleAppPlayback: (appId: string) => void;
  launchAtStartup: boolean;
  onToggleLaunchAtStartup: () => void;
  minimizeToTray: boolean;
  onToggleMinimizeToTray: () => void;
  autoRestoreOnReconnect: boolean;
  onToggleAutoRestore: () => void;
  shortcuts: GlobalShortcutsConfig;
  onUpdateShortcut: (key: keyof GlobalShortcutsConfig, value: string) => void;
  onResetSavedPreferences: () => void;
  physicalSinks: MediaDeviceInfo[];
  onBindPhysicalSink: (deviceId: string, sinkId: string) => void;
  audibleMonitor: boolean;
  onToggleAudibleMonitor: () => void;
  telemetry: AudioTelemetryFrame;
  logs: RoutingLogEntry[];
  onOpenTauriCode: () => void;
}

export const AdvancedSettingsModal: React.FC<AdvancedSettingsModalProps> = ({
  isOpen,
  onClose,
  devices,
  defaultDeviceId,
  onSelectDefaultDevice,
  onToggleDeviceConnection,
  apps,
  launchableApps,
  savedPreferences,
  onToggleLaunchApp,
  onToggleAppPlayback,
  launchAtStartup,
  onToggleLaunchAtStartup,
  minimizeToTray,
  onToggleMinimizeToTray,
  autoRestoreOnReconnect,
  onToggleAutoRestore,
  shortcuts,
  onUpdateShortcut,
  onResetSavedPreferences,
  physicalSinks,
  onBindPhysicalSink,
  audibleMonitor,
  onToggleAudibleMonitor,
  telemetry,
  logs,
  onOpenTauriCode,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'devices' | 'processes' | 'logs'>('general');
  const [editingShortcutKey, setEditingShortcutKey] = useState<keyof GlobalShortcutsConfig | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'checking' | 'available' | 'downloading' | 'up-to-date' | 'error'
  >('idle');
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [updateMessage, setUpdateMessage] = useState<string>(
    'Endpoint: github.com/gfxmahdi777/SoundFlow (v1.0.0)'
  );

  if (!isOpen) return null;

  const connectedDevices = devices.filter((d) => d.status === 'connected');

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    setUpdateMessage('Checking GitHub Releases for updates...');
    try {
      if (isTauriRuntime()) {
        const update = await check();
        if (update) {
          setPendingUpdate(update);
          setUpdateVersion(update.version);
          setUpdateNotes(update.body || 'New SoundFlow release available.');
          setUpdateStatus('available');
          setUpdateMessage(
            `Update v${update.version} is available! Ready to download and install.`
          );
          return;
        }
        setPendingUpdate(null);
        setUpdateStatus('up-to-date');
        setUpdateMessage('You are running the latest version of SoundFlow (v1.0.0).');
      } else {
        // Fallback check against GitHub latest.json in browser preview
        const res = await fetch(
          'https://github.com/gfxmahdi777/SoundFlow/releases/latest/download/latest.json'
        ).catch(() => null);
        if (res && res.ok) {
          const data = (await res.json()) as { version?: string; notes?: string };
          if (data.version && data.version !== '1.0.0' && data.version !== 'v1.0.0') {
            setUpdateVersion(data.version);
            setUpdateNotes(data.notes || 'New SoundFlow release available on GitHub.');
            setUpdateStatus('available');
            setUpdateMessage(`Update ${data.version} found on GitHub Releases.`);
            return;
          }
        }
        setUpdateStatus('up-to-date');
        setUpdateMessage('SoundFlow v1.0.0 is up to date.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('404') || msg.toLowerCase().includes('release')) {
        setUpdateStatus('up-to-date');
        setUpdateMessage('SoundFlow v1.0.0 is up to date (no newer release published yet).');
      } else {
        setUpdateStatus('error');
        setUpdateMessage(`Update check info: ${msg}`);
      }
    }
  };

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) return;
    setUpdateStatus('downloading');
    setDownloadProgress(0);
    setUpdateMessage(`Downloading SoundFlow v${pendingUpdate.version}...`);

    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength || 0;
          downloadedBytes = 0;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setDownloadProgress(
              Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            );
          }
        } else if (event.event === 'Finished') {
          setDownloadProgress(100);
        }
      });
      setUpdateMessage('Update installed! Relaunching SoundFlow...');
      await relaunch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateStatus('error');
      setUpdateMessage(`Failed to install update: ${msg}`);
    }
  };

  const handleShortcutKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    key: keyof GlobalShortcutsConfig
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const code = e.key.toUpperCase();
    if (!['CONTROL', 'ALT', 'SHIFT', 'META'].includes(code) && code.length === 1) {
      parts.push(code);
      const combo = parts.length > 1 ? parts.join('+') : `Alt+${code}`;
      onUpdateShortcut(key, combo);
      setEditingShortcutKey(null);
    } else if (e.key === 'Escape') {
      setEditingShortcutKey(null);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#172033]/25 backdrop-blur-md flex items-center justify-center p-4 select-none"
      role="dialog"
      aria-label="SoundFlow Advanced Settings"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.84)',
          borderColor: 'rgba(255, 255, 255, 0.9)',
        }}
        className="w-full max-w-2xl rounded-[18px] backdrop-blur-2xl border shadow-[0_24px_60px_rgba(23,32,51,0.16),0_0_0_1px_rgba(52,120,246,0.08)] text-[#172033] overflow-hidden flex flex-col max-h-[84vh]"
      >
        {/* Top Blue Gradient Line */}
        <div
          className="h-[3px] w-full shrink-0"
          style={{
            background: 'linear-gradient(90deg, #3478F6 0%, #70A5FF 100%)',
          }}
        />

        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#172033]/[0.07] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <SoundFlowBrandIcon size={22} />
            <div>
              <h2 className="font-display font-bold text-sm text-[#172033]">
                SoundFlow Advanced Settings
              </h2>
              <p className="text-[11px] text-[#758198]">
                Startup behavior, device recovery, process management, and WASAPI diagnostics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCheckForUpdates()}
              disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.75)',
                borderColor: 'rgba(255, 255, 255, 0.9)',
              }}
              className="px-3 py-1.5 rounded-[10px] hover:bg-white text-xs font-medium text-[#172033] border shadow-2xs flex items-center gap-1.5 cursor-pointer transition-all disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#3478F6] ${
                  updateStatus === 'checking' ? 'animate-spin' : ''
                }`}
              />
              <span>
                {updateStatus === 'checking' ? 'Checking...' : 'Check for Updates'}
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenTauriCode}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.75)',
                borderColor: 'rgba(255, 255, 255, 0.9)',
              }}
              className="px-3 py-1.5 rounded-[10px] hover:bg-white text-xs font-medium text-[#172033] border shadow-2xs flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Code2 className="w-3.5 h-3.5 text-[#3478F6]" />
              <span>Tauri 2 Rust Source</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.75)',
                borderColor: 'rgba(255, 255, 255, 0.9)',
              }}
              className="p-1.5 rounded-[10px] text-[#758198] hover:text-[#172033] hover:bg-white border shadow-2xs cursor-pointer transition-all"
              aria-label="Close settings"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2 border-b border-[#172033]/[0.07] bg-white/40 flex items-center gap-1 overflow-x-auto shrink-0">
          {(
            [
              ['general', 'General & Shortcuts'],
              ['devices', `Device Hot-Plug (${connectedDevices.length}/${devices.length})`],
              ['processes', `Application Processes (${apps.length})`],
              ['logs', 'WASAPI Event Log'],
            ] as const
          ).map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === tabKey
                  ? 'border-[#3478F6] text-[#3478F6]'
                  : 'border-transparent text-[#758198] hover:text-[#172033]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="p-5 overflow-y-auto soundflow-scroll space-y-4 flex-1 min-h-0">
          {/* TAB 1: General & Shortcuts */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              {/* In-App Auto-Updater Card */}
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.72)',
                  borderColor:
                    updateStatus === 'available'
                      ? 'rgba(52, 120, 246, 0.45)'
                      : 'rgba(255, 255, 255, 0.88)',
                }}
                className="p-3.5 rounded-[14px] border shadow-2xs flex flex-col gap-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-[#172033] flex items-center gap-2">
                      <span>SoundFlow Auto-Updater (Tauri v2)</span>
                      <span className="px-1.5 py-0.5 rounded-[6px] bg-[#3478F6]/10 text-[#3478F6] font-mono text-[10px] font-semibold">
                        v1.0.0
                      </span>
                    </div>
                    <div className="text-[11px] text-[#758198] mt-0.5">
                      {updateMessage}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {updateStatus === 'available' && pendingUpdate ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleInstallUpdate()}
                          className="px-3 py-1.5 rounded-[9px] bg-[#16A36A] hover:bg-[#15803D] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Install v{updateVersion} &amp; Restart</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setUpdateStatus('idle')}
                          className="px-2.5 py-1.5 rounded-[9px] bg-white hover:bg-[#F5F8FF] text-[#758198] hover:text-[#172033] border border-[#172033]/10 text-xs cursor-pointer transition-colors"
                        >
                          Later
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleCheckForUpdates()}
                        disabled={
                          updateStatus === 'checking' || updateStatus === 'downloading'
                        }
                        className="px-3 py-1.5 rounded-[9px] bg-[#3478F6] hover:bg-[#2563EB] disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            updateStatus === 'checking' ? 'animate-spin' : ''
                          }`}
                        />
                        <span>
                          {updateStatus === 'checking'
                            ? 'Checking...'
                            : updateStatus === 'downloading'
                            ? `Installing (${downloadProgress}%)...`
                            : 'Check for Updates'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {updateStatus === 'available' && updateNotes && (
                  <div className="px-3 py-2 rounded-[10px] bg-[#F5F8FF] border border-[#3478F6]/20 text-[11px] text-[#172033]">
                    <span className="font-semibold text-[#3478F6]">Release Notes: </span>
                    <span>{updateNotes}</span>
                  </div>
                )}

                {updateStatus === 'downloading' && (
                  <div className="w-full h-1.5 rounded-full bg-[#E3EAF6] overflow-hidden">
                    <div
                      style={{ width: `${downloadProgress}%` }}
                      className="h-full bg-[#3478F6] transition-all duration-150"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#758198]">
                  Windows System Tray &amp; Engine Preferences
                </span>
                <button
                  type="button"
                  onClick={onResetSavedPreferences}
                  className="px-2.5 py-1 rounded-[9px] bg-white/75 hover:bg-rose-50 text-[#758198] hover:text-rose-600 border border-[#172033]/10 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Saved Routes</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.65)',
                    borderColor: 'rgba(255, 255, 255, 0.85)',
                  }}
                  className="p-3 rounded-[14px] border shadow-2xs flex items-center justify-between gap-3 cursor-pointer hover:bg-white/80 transition-all"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#172033]">
                      Launch at Windows Startup
                    </div>
                    <div className="text-[11px] text-[#758198]">
                      Start minimized in System Tray
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={launchAtStartup}
                    onChange={onToggleLaunchAtStartup}
                    className="accent-[#3478F6] w-4 h-4 cursor-pointer shrink-0"
                  />
                </label>

                <label
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.65)',
                    borderColor: 'rgba(255, 255, 255, 0.85)',
                  }}
                  className="p-3 rounded-[14px] border shadow-2xs flex items-center justify-between gap-3 cursor-pointer hover:bg-white/80 transition-all"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#172033]">
                      Minimize to System Tray
                    </div>
                    <div className="text-[11px] text-[#758198]">
                      Keep audio engine running on close
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={minimizeToTray}
                    onChange={onToggleMinimizeToTray}
                    className="accent-[#3478F6] w-4 h-4 cursor-pointer shrink-0"
                  />
                </label>

                <label
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.65)',
                    borderColor: 'rgba(255, 255, 255, 0.85)',
                  }}
                  className="p-3 rounded-[14px] border shadow-2xs flex items-center justify-between gap-3 cursor-pointer hover:bg-white/80 transition-all"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#172033]">
                      Auto-Restore on Device Reconnect
                    </div>
                    <div className="text-[11px] text-[#758198]">
                      Re-bind apps when devices plug back in
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoRestoreOnReconnect}
                    onChange={onToggleAutoRestore}
                    className="accent-[#3478F6] w-4 h-4 cursor-pointer shrink-0"
                  />
                </label>

                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.65)',
                    borderColor: 'rgba(255, 255, 255, 0.85)',
                  }}
                  className="p-3 rounded-[14px] border shadow-2xs flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-xs font-semibold text-[#172033]">
                      Audible Stream Monitor
                    </div>
                    <div className="text-[11px] text-[#758198]">
                      Hear routed Web Audio streams
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onToggleAudibleMonitor}
                    className={`px-2.5 py-1 rounded-[9px] text-xs font-medium flex items-center gap-1.5 border cursor-pointer transition-colors ${
                      audibleMonitor
                        ? 'bg-[#16A36A]/12 text-[#16A36A] border-[#16A36A]/35'
                        : 'bg-[#F5F8FF] text-[#758198] hover:text-[#172033] border-[#172033]/10'
                    }`}
                  >
                    {audibleMonitor ? (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Active</span>
                      </>
                    ) : (
                      <>
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>Muted</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Global Keyboard Shortcuts */}
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.65)',
                  borderColor: 'rgba(255, 255, 255, 0.85)',
                }}
                className="p-3.5 rounded-[14px] border shadow-2xs space-y-2.5"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-[#172033]">
                  <Keyboard className="w-3.5 h-3.5 text-[#3478F6]" />
                  <span>Global Keyboard Shortcuts (Click to Rebind)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {(
                    [
                      ['togglePopup', 'Toggle SoundFlow Popup'],
                      ['muteActiveApp', 'Quick Mute Active App'],
                      ['cycleDefaultDevice', 'Cycle Default Output'],
                      ['pauseResumeRouting', 'Pause / Resume Routing'],
                    ] as const
                  ).map(([key, label]) => (
                    <div
                      key={key}
                      className="px-3 py-1.5 rounded-[10px] bg-[#F5F8FF]/90 border border-[#172033]/[0.05] flex items-center justify-between"
                    >
                      <span className="text-[#758198] text-[11.5px]">{label}</span>
                      <button
                        type="button"
                        onClick={() => setEditingShortcutKey(key)}
                        onKeyDown={(e) => {
                          if (editingShortcutKey === key) {
                            handleShortcutKeyDown(e, key);
                          }
                        }}
                        className={`px-2 py-0.5 rounded-[6px] font-mono text-[11px] border cursor-pointer transition-colors ${
                          editingShortcutKey === key
                            ? 'bg-[#3478F6] text-white border-[#3478F6]'
                            : 'bg-white text-[#172033] border-[#172033]/12 hover:border-[#3478F6]'
                        }`}
                      >
                        {editingShortcutKey === key ? 'Press key...' : shortcuts[key]}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional Browser Hardware Sink Binding */}
              {physicalSinks.length > 0 && (
                <div
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.65)',
                    borderColor: 'rgba(255, 255, 255, 0.85)',
                  }}
                  className="p-3.5 rounded-[14px] border shadow-2xs space-y-2"
                >
                  <div className="text-xs font-semibold text-[#172033]">
                    Hardware Audio Sink Mapping (setSinkId)
                  </div>
                  <div className="space-y-1.5">
                    {connectedDevices.map((dev) => (
                      <div
                        key={dev.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-[#758198] truncate">
                          {dev.name} — {dev.driver}
                        </span>
                        <select
                          value={dev.hardwareSinkId || ''}
                          onChange={(e) => onBindPhysicalSink(dev.id, e.target.value)}
                          className="px-2 py-1 rounded-[8px] bg-white border border-[#172033]/12 text-[#172033] text-xs max-w-[220px]"
                        >
                          <option value="">System Default Sink</option>
                          {physicalSinks.map((sink) => (
                            <option key={sink.deviceId} value={sink.deviceId}>
                              {sink.label || `Audio Output (${sink.deviceId.slice(0, 6)})`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Device Hot-Plug & Recovery */}
          {activeTab === 'devices' && (
            <div className="space-y-3">
              <p className="text-xs text-[#758198]">
                Manage audio output endpoints and test device disconnection fallback and automatic reconnection recovery:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {devices.map((device) => {
                  const isConnected = device.status === 'connected';
                  const isDefault = device.id === defaultDeviceId;
                  const devLevel = telemetry.deviceLevels[device.id] || {
                    db: -60,
                    peak: 0,
                    activeStreamCount: 0,
                  };

                  return (
                    <div
                      key={device.id}
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.65)',
                        borderColor: 'rgba(255, 255, 255, 0.85)',
                      }}
                      className={`p-3.5 rounded-[14px] border shadow-2xs flex flex-col justify-between gap-2.5 ${
                        isConnected ? '' : 'opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 ${
                              isConnected
                                ? 'bg-[#3478F6]/12 text-[#3478F6]'
                                : 'bg-[#F5F8FF] text-[#758198]'
                            }`}
                          >
                            <DeviceEndpointIcon formFactor={device.formFactor} className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#172033] truncate">
                              {device.name} — {device.driver}
                            </div>
                            <div className="text-[11px] text-[#758198] flex items-center gap-1.5">
                              <span
                                className={
                                  isConnected
                                    ? 'text-[#16A36A] font-medium'
                                    : 'text-rose-500 font-medium'
                                }
                              >
                                {isConnected ? 'Connected' : 'Disconnected'}
                              </span>
                              <span>·</span>
                              <span className="font-mono tabular-nums">{device.sampleRate}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onToggleDeviceConnection(device.id)}
                          className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium flex items-center gap-1 border cursor-pointer shrink-0 transition-colors ${
                            isConnected
                              ? 'bg-white text-[#758198] hover:text-rose-600 border-[#172033]/10'
                              : 'bg-[#16A36A]/12 text-[#16A36A] border-[#16A36A]/35'
                          }`}
                        >
                          {isConnected ? (
                            <>
                              <Unplug className="w-3 h-3" />
                              <span>Disconnect</span>
                            </>
                          ) : (
                            <>
                              <Plug className="w-3 h-3" />
                              <span>Connect</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="pt-2 border-t border-[#172033]/[0.06] flex items-center justify-between text-[11px]">
                        <span className="text-[#758198] font-mono tabular-nums">
                          {devLevel.activeStreamCount} active stream(s) ·{' '}
                          {isConnected && devLevel.db > -59 ? `${devLevel.db.toFixed(1)} dB` : '-∞ dB'}
                        </span>
                        {isConnected && (
                          <button
                            type="button"
                            onClick={() => onSelectDefaultDevice(device.id)}
                            className={`text-[11px] font-semibold cursor-pointer ${
                              isDefault ? 'text-[#3478F6]' : 'text-[#758198] hover:text-[#172033]'
                            }`}
                          >
                            {isDefault ? 'Default Output' : 'Set Default'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: Application Processes */}
          {activeTab === 'processes' && (
            <div className="space-y-3">
              <p className="text-xs text-[#758198]">
                Manage detected Windows application audio sessions and saved endpoint rules:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {launchableApps.map((proc) => {
                  const activeSession = apps.find((a) => a.executable === proc.executable);
                  const savedPref = savedPreferences[proc.executable];
                  const savedDeviceName = savedPref
                    ? devices.find((d) => d.id === savedPref.preferredDeviceId)?.name ||
                      savedPref.preferredDeviceId
                    : 'Default Output';

                  return (
                    <div
                      key={proc.executable}
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.65)',
                        borderColor: 'rgba(255, 255, 255, 0.85)',
                      }}
                      className="p-3 rounded-[14px] border shadow-2xs flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ApplicationIcon type={proc.iconType} />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#172033] truncate">
                            {proc.name}
                          </div>
                          <div className="text-[11px] text-[#758198] truncate font-mono tabular-nums">
                            {proc.executable} · Rule: {savedDeviceName}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {activeSession && (
                          <button
                            type="button"
                            onClick={() => onToggleAppPlayback(activeSession.id)}
                            title={activeSession.isPlaying ? 'Pause stream' : 'Resume stream'}
                            className={`p-1.5 rounded-[7px] border cursor-pointer ${
                              activeSession.isPlaying
                                ? 'bg-[#16A36A]/12 text-[#16A36A] border-[#16A36A]/35'
                                : 'bg-white text-[#758198] border-[#172033]/10'
                            }`}
                          >
                            {activeSession.isPlaying ? (
                              <Square className="w-3 h-3 fill-current" />
                            ) : (
                              <Play className="w-3 h-3 fill-current" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onToggleLaunchApp(proc)}
                          className={`px-2.5 py-1 rounded-[8px] text-[11px] font-medium flex items-center gap-1 border cursor-pointer ${
                            activeSession
                              ? 'bg-white text-rose-600 border-[#172033]/10 hover:bg-rose-50'
                              : 'bg-[#3478F6] text-white border-[#3478F6] hover:bg-[#2563EB]'
                          }`}
                        >
                          {activeSession ? (
                            <>
                              <Trash2 className="w-3 h-3" />
                              <span>Close</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              <span>Launch</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: WASAPI Event Log */}
          {activeTab === 'logs' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[#758198]">
                <span>Real-Time WASAPI Audio Routing &amp; Recovery Events</span>
                <span className="font-mono tabular-nums">
                  Latency: {telemetry.engineLatencyMs}ms · {telemetry.sampleRateHz / 1000}kHz
                </span>
              </div>

              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.65)',
                  borderColor: 'rgba(255, 255, 255, 0.85)',
                }}
                className="rounded-[14px] border shadow-2xs p-3.5 max-h-[300px] overflow-y-auto soundflow-scroll space-y-2"
              >
                {logs.map((entry) => (
                  <div
                    key={entry.id}
                    className="pb-2 border-b border-[#172033]/[0.06] last:border-none last:pb-0 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="text-[#172033] font-medium flex items-center gap-1.5">
                        {entry.type === 'recovery' || entry.type === 'route' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                        ) : entry.type === 'hotplug' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        ) : (
                          <Sliders className="w-3.5 h-3.5 text-[#3478F6] shrink-0" />
                        )}
                        <span>{entry.message}</span>
                      </div>
                      {entry.detail && (
                        <div className="text-[11px] text-[#758198] pl-5">{entry.detail}</div>
                      )}
                    </div>
                    <span className="text-[10.5px] font-mono tabular-nums text-[#758198] shrink-0">
                      {entry.timestamp}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
