import React, { useState, useEffect } from 'react';
import {
  AppAudioSession,
  AudioOutputDevice,
  AudioTelemetryFrame,
} from '../types/soundflow';
import {
  ApplicationIcon,
  DeviceEndpointIcon,
  SoundFlowBrandIcon,
} from './AppIcons';
import {
  Volume2,
  VolumeX,
  RefreshCw,
  Settings,
  ChevronDown,
  Check,
  Pause,
  Play,
  AudioWaveform,
} from 'lucide-react';

interface SoundFlowPopupProps {
  isOpen: boolean;
  routingActive: boolean;
  onToggleRoutingActive: () => void;
  devices: AudioOutputDevice[];
  defaultDeviceId: string;
  onSelectDefaultDevice: (deviceId: string) => void;
  apps: AppAudioSession[];
  onAssignAppDevice: (appId: string, targetDeviceId: string) => void;
  onChangeAppVolume: (appId: string, volume: number) => void;
  onToggleAppMute: (appId: string) => void;
  onRefreshApps: () => void;
  onOpenAdvancedSettings: () => void;
  telemetry: AudioTelemetryFrame;
}

/**
 * Computes the dynamic VU meter color based on live peak level (0.0 to 1.0)
 * similar to the Windows Volume Mixer level bar with clip/peak warning states.
 */
function getMeterBarGradient(peak: number): string {
  if (peak >= 0.85) {
    return 'linear-gradient(90deg, #16A36A 0%, #F59E0B 65%, #EF4444 100%)';
  }
  if (peak >= 0.65) {
    return 'linear-gradient(90deg, #16A36A 0%, #3478F6 60%, #F59E0B 100%)';
  }
  return 'linear-gradient(90deg, #16A36A 0%, #3478F6 100%)';
}

export const SoundFlowPopup: React.FC<SoundFlowPopupProps> = React.memo(
  ({
    isOpen,
    routingActive,
    onToggleRoutingActive,
    devices,
    defaultDeviceId,
    onSelectDefaultDevice,
    apps,
    onAssignAppDevice,
    onChangeAppVolume,
    onToggleAppMute,
    onRefreshApps,
    onOpenAdvancedSettings,
    telemetry,
  }) => {
    const [openDropdownAppId, setOpenDropdownAppId] = useState<string | null>(null);
    const [justRoutedAppId, setJustRoutedAppId] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
      if (!openDropdownAppId) return;
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setOpenDropdownAppId(null);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [openDropdownAppId]);

    if (!isOpen) return null;

    const connectedDevices = devices.filter((d) => d.status === 'connected');
    const defaultDevice =
      connectedDevices.find((d) => d.id === defaultDeviceId) || connectedDevices[0];

    const handleRefreshClick = () => {
      setIsRefreshing(true);
      onRefreshApps();
      window.setTimeout(() => setIsRefreshing(false), 320);
    };

    const handleSelectRoute = (appId: string, targetDeviceId: string) => {
      onAssignAppDevice(appId, targetDeviceId);
      setOpenDropdownAppId(null);
      setJustRoutedAppId(appId);
      window.setTimeout(() => {
        setJustRoutedAppId((prev) => (prev === appId ? null : prev));
      }, 650);
    };

    const getAssignedDeviceLabel = (app: AppAudioSession): string => {
      if (app.assignedDeviceId === 'unassigned') {
        return 'Not Assigned';
      }
      if (app.assignedDeviceId === 'default') {
        return defaultDevice ? `Default (${defaultDevice.name})` : 'Default Output';
      }
      const found = devices.find((d) => d.id === app.assignedDeviceId);
      if (!found) return 'Not Assigned';
      if (found.status === 'disconnected') {
        return defaultDevice ? `${defaultDevice.name}` : 'Default Output';
      }
      return found.name;
    };

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (openDropdownAppId) setOpenDropdownAppId(null);
        }}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.72)',
          borderColor: 'rgba(255, 255, 255, 0.85)',
        }}
        className="sf-animate-popup w-[400px] h-[560px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-68px)] rounded-[18px] backdrop-blur-2xl border shadow-[0_20px_50px_rgba(23,32,51,0.12),0_4px_16px_rgba(52,120,246,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] text-[#172033] overflow-hidden flex flex-col select-none"
        role="dialog"
        aria-label="SoundFlow Audio Controller"
      >
        {/* Top Subtle Blue Gradient Accent Hairline */}
        <div
          className="h-[3px] w-full shrink-0"
          style={{
            background: routingActive
              ? 'linear-gradient(90deg, #3478F6 0%, #70A5FF 100%)'
              : '#CBD5E1',
          }}
        />

        {/* 1. Compact Header */}
        <div className="px-4 py-3 flex items-center justify-between border-b border-[#172033]/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <SoundFlowBrandIcon size={24} />
            <span className="font-display font-bold text-[15px] tracking-tight text-[#172033]">
              SoundFlow
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Green Live Routing Indicator */}
            <button
              type="button"
              onClick={onToggleRoutingActive}
              title={
                routingActive ? 'Click to pause audio routing' : 'Click to resume audio routing'
              }
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.65)',
                borderColor: 'rgba(255, 255, 255, 0.85)',
              }}
              className="px-2.5 py-1 rounded-[10px] border shadow-[0_1px_3px_rgba(23,32,51,0.05)] hover:bg-white/90 flex items-center gap-1.5 text-[11.5px] font-medium transition-all cursor-pointer"
            >
              <span
                className={`w-2 h-2 rounded-full transition-colors ${
                  routingActive ? 'bg-[#16A36A]' : 'bg-amber-500'
                }`}
              />
              <span className={routingActive ? 'text-[#16A36A]' : 'text-amber-600'}>
                {routingActive ? 'Live Routing' : 'Paused'}
              </span>
            </button>

            {/* Refresh Application List */}
            <button
              type="button"
              onClick={handleRefreshClick}
              title="Refresh application list"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.65)',
                borderColor: 'rgba(255, 255, 255, 0.85)',
              }}
              className="p-1.5 rounded-[10px] text-[#758198] hover:text-[#172033] hover:bg-white/90 border shadow-[0_1px_3px_rgba(23,32,51,0.05)] transition-all cursor-pointer"
              aria-label="Refresh application list"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 transition-transform duration-300 ${
                  isRefreshing ? 'rotate-180 text-[#3478F6]' : ''
                }`}
              />
            </button>

            {/* Settings Icon */}
            <button
              type="button"
              onClick={onOpenAdvancedSettings}
              title="Advanced Settings"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.65)',
                borderColor: 'rgba(255, 255, 255, 0.85)',
              }}
              className="p-1.5 rounded-[10px] text-[#758198] hover:text-[#172033] hover:bg-white/90 border shadow-[0_1px_3px_rgba(23,32,51,0.05)] transition-all cursor-pointer"
              aria-label="Open Advanced Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 2. Connected Devices Section (Compact Glass Cards with Live Peak Meter) */}
        <div className="px-3.5 pt-3 pb-2.5 border-b border-[#172033]/[0.06] shrink-0">
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[11px] font-semibold text-[#758198]">
              Connected Devices
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#758198]">
              <span>Default:</span>
              <select
                value={defaultDeviceId}
                onChange={(e) => onSelectDefaultDevice(e.target.value)}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.78)',
                  borderColor: 'rgba(255, 255, 255, 0.9)',
                }}
                className="text-[#172033] font-medium px-2 py-0.5 rounded-[8px] border shadow-2xs text-[11px] focus:outline-none focus:border-[#3478F6] cursor-pointer"
                aria-label="Default Output Selection"
              >
                {connectedDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            {connectedDevices.map((device) => {
              const isDefault = device.id === defaultDeviceId;
              const devLevel = telemetry.deviceLevels[device.id] || {
                db: -60,
                peak: 0,
                activeStreamCount: 0,
              };
              const rawPeak =
                routingActive && !device.muted
                  ? Math.max(0, Math.min(1, devLevel.peak || 0))
                  : 0;
              const isMeterActive = rawPeak > 0.005;
              const meterPct = isMeterActive ? Math.min(100, Math.round(rawPeak * 100)) : 0;

              return (
                <div
                  key={device.id}
                  onClick={() => onSelectDefaultDevice(device.id)}
                  title="Click to set as Default Output"
                  style={{
                    backgroundColor: isDefault
                      ? 'rgba(255, 255, 255, 0.85)'
                      : 'rgba(255, 255, 255, 0.65)',
                    borderColor: isDefault
                      ? 'rgba(52, 120, 246, 0.45)'
                      : 'rgba(255, 255, 255, 0.85)',
                  }}
                  className="relative overflow-hidden px-3 py-1.5 rounded-[14px] border shadow-[0_2px_8px_rgba(23,32,51,0.04)] hover:bg-white/90 transition-all cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-[8px] flex items-center justify-center shrink-0 transition-colors ${
                        isDefault
                          ? 'bg-[#3478F6]/12 text-[#3478F6]'
                          : 'bg-[#F5F8FF] text-[#758198]'
                      }`}
                    >
                      <DeviceEndpointIcon
                        formFactor={device.formFactor}
                        className="w-3.5 h-3.5"
                      />
                    </div>
                    <div className="text-[12px] truncate">
                      <span className="font-semibold text-[#172033]">{device.name}</span>
                      <span className="text-[#758198] mx-1.5">—</span>
                      <span className="text-[#758198]">{device.driver}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Compact inline device VU meter */}
                    <div className="w-10 h-1.5 bg-[#E2E8F4]/80 rounded-full overflow-hidden">
                      <div
                        style={{
                          width: `${meterPct}%`,
                          opacity: isMeterActive ? 1 : 0,
                          background: getMeterBarGradient(rawPeak),
                          transition:
                            'width 75ms ease-out, background-color 0.1s ease, opacity 75ms ease-out',
                        }}
                        className="h-full rounded-full"
                      />
                    </div>
                    <span className="text-[11px] font-medium text-[#16A36A]">
                      Connected
                    </span>
                  </div>

                  {/* Bottom full-width live device peak hairline */}
                  <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[2px] bg-transparent overflow-hidden">
                    <div
                      style={{
                        width: `${meterPct}%`,
                        opacity: isMeterActive ? 0.9 : 0,
                        background: getMeterBarGradient(rawPeak),
                        transition:
                          'width 75ms ease-out, background-color 0.1s ease, opacity 75ms ease-out',
                      }}
                      className="h-full"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Application Routing Section (Scrollable Main Area) */}
        <div className="flex-1 min-h-0 px-3.5 py-2.5 flex flex-col">
          <div className="flex items-center justify-between mb-2 px-0.5 shrink-0">
            <span className="text-[11px] font-semibold text-[#758198]">
              Application Routing ({apps.length})
            </span>
            <span className="text-[11px] text-[#758198]">Audio Output</span>
          </div>

          <div
            onScroll={() => {
              if (openDropdownAppId) setOpenDropdownAppId(null);
            }}
            className="flex-1 min-h-0 overflow-y-auto soundflow-scroll space-y-2 pr-0.5"
          >
            {apps.length === 0 ? (
              <div
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.58)',
                  borderColor: 'rgba(255, 255, 255, 0.85)',
                }}
                className="h-full min-h-[160px] rounded-[14px] border px-4 py-6 flex flex-col items-center justify-center text-center"
              >
                <div className="w-9 h-9 rounded-full bg-[#3478F6]/10 text-[#3478F6] flex items-center justify-center mb-2">
                  <AudioWaveform className="w-4 h-4" />
                </div>
                <div className="text-[12.5px] font-semibold text-[#172033]">
                  No Active Audio Streams
                </div>
                <p className="text-[11px] text-[#758198] mt-1 max-w-[240px]">
                  Play audio in any Windows application (Chrome, Brave, Spotify, VLC, or a game) to route and monitor it here in real time.
                </p>
              </div>
            ) : (
              apps.map((app, index) => {
                const displayAppName =
                  app.name && app.name.trim().length > 0
                    ? app.name.trim()
                    : 'Unknown App';

                const appLevel =
                  telemetry.appLevels[app.id] ||
                  telemetry.appLevels[`app-${app.pid}`] || {
                    db: -60,
                    peak: 0,
                    waveform: [],
                    effectiveDeviceId: null,
                  };

                const isDropdownOpen = openDropdownAppId === app.id;
                const isJustRouted = justRoutedAppId === app.id;
                const isUnassigned = app.assignedDeviceId === 'unassigned';
                const assignedLabel = getAssignedDeviceLabel(app);

                // Compute real-time peak value (0.0 to 1.0) scaled by mute/routing status
                const rawPeak =
                  !app.muted && !isUnassigned && routingActive && app.volume > 0
                    ? Math.max(0, Math.min(1, appLevel.peak || 0))
                    : 0;
                const isPeakActive = rawPeak > 0.005;
                const peakWidthPct = isPeakActive
                  ? Math.min(100, Math.round(rawPeak * 100))
                  : 0;
                const sliderOverlayPct = isPeakActive
                  ? Math.min(app.volume, Math.round(rawPeak * (app.volume || 100)))
                  : 0;

                // Open dropdown upward for bottom items so it never clips inside scroll view
                const openUpward = apps.length >= 3 && index >= apps.length - 2;

                return (
                  <div
                    key={app.id}
                    style={{
                      backgroundColor: isJustRouted
                        ? 'rgba(255, 255, 255, 0.92)'
                        : 'rgba(255, 255, 255, 0.65)',
                      borderColor: isJustRouted
                        ? 'rgba(22, 163, 106, 0.5)'
                        : isPeakActive
                        ? 'rgba(52, 120, 246, 0.35)'
                        : 'rgba(255, 255, 255, 0.85)',
                    }}
                    className={`relative ${
                      isDropdownOpen ? 'z-30' : 'z-10'
                    } px-3 py-2.5 rounded-[14px] border shadow-[0_2px_10px_rgba(23,32,51,0.04)] hover:bg-white/85 transition-all duration-150`}
                  >
                    {/* Row 1: App Icon + Name + Live Activity Dot + Output Device Dropdown */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          <ApplicationIcon type={app.iconType} className="w-6.5 h-6.5" />
                          {isPeakActive && (
                            <span
                              style={{
                                transform: `scale(${0.85 + rawPeak * 0.35})`,
                                transition: 'transform 75ms ease-out, opacity 75ms ease-out',
                              }}
                              className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#16A36A] ring-2 ring-white"
                            />
                          )}
                        </div>
                        <span
                          className="text-[12.5px] font-semibold text-[#172033] truncate"
                          title={displayAppName}
                        >
                          {displayAppName}
                        </span>
                      </div>

                      {/* Output Device Dropdown */}
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenDropdownAppId(isDropdownOpen ? null : app.id);
                          }}
                          className={`h-7 px-2.5 rounded-[10px] text-[11.5px] font-medium flex items-center justify-between gap-1.5 min-w-[138px] border transition-all cursor-pointer whitespace-nowrap shadow-2xs ${
                            isJustRouted
                              ? 'bg-[#E8F8F0] text-[#16A36A] border-[#16A36A]/45'
                              : isUnassigned
                              ? 'bg-[#F5F8FF]/90 text-[#758198] border-[#172033]/10 hover:border-[#3478F6]/40'
                              : 'bg-white/95 text-[#172033] border-[#3478F6]/35 hover:border-[#3478F6]'
                          }`}
                          aria-haspopup="listbox"
                          aria-expanded={isDropdownOpen}
                        >
                          <span className="truncate max-w-[102px]">{assignedLabel}</span>
                          <ChevronDown
                            className={`w-3.5 h-3.5 text-[#758198] shrink-0 transition-transform duration-150 ${
                              isDropdownOpen ? 'rotate-180 text-[#3478F6]' : ''
                            }`}
                          />
                        </button>

                        {isDropdownOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              backgroundColor: 'rgba(255, 255, 255, 0.96)',
                              borderColor: 'rgba(255, 255, 255, 0.92)',
                            }}
                            className={`absolute right-0 ${
                              openUpward
                                ? 'bottom-full mb-1.5 sf-animate-dropdown-up'
                                : 'top-full mt-1.5 sf-animate-dropdown'
                            } w-52 rounded-[14px] backdrop-blur-2xl border shadow-[0_14px_34px_rgba(23,32,51,0.18),0_0_0_1px_rgba(23,32,51,0.06)] py-1.5 z-50`}
                            role="listbox"
                          >
                            {connectedDevices.map((dev) => {
                              const selected = app.assignedDeviceId === dev.id;
                              return (
                                <button
                                  key={dev.id}
                                  type="button"
                                  onClick={() => handleSelectRoute(app.id, dev.id)}
                                  className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 hover:bg-[#F5F8FF] transition-colors cursor-pointer ${
                                    selected ? 'text-[#3478F6] font-semibold' : 'text-[#172033]'
                                  }`}
                                >
                                  <div className="truncate">
                                    <span>{dev.name}</span>
                                    <span className="text-[#758198] ml-1 text-[11px] font-normal">
                                      — {dev.driver}
                                    </span>
                                  </div>
                                  {selected && (
                                    <Check className="w-3.5 h-3.5 text-[#3478F6] shrink-0" />
                                  )}
                                </button>
                              );
                            })}

                            <div className="my-1 border-t border-[#172033]/[0.07]" />

                            <button
                              type="button"
                              onClick={() => handleSelectRoute(app.id, 'default')}
                              className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 hover:bg-[#F5F8FF] transition-colors cursor-pointer ${
                                app.assignedDeviceId === 'default'
                                  ? 'text-[#3478F6] font-semibold'
                                  : 'text-[#172033]'
                              }`}
                            >
                              <span>
                                Default ({defaultDevice ? defaultDevice.name : 'Auto'})
                              </span>
                              {app.assignedDeviceId === 'default' && (
                                <Check className="w-3.5 h-3.5 text-[#3478F6] shrink-0" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSelectRoute(app.id, 'unassigned')}
                              className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2 hover:bg-[#F5F8FF] transition-colors cursor-pointer ${
                                app.assignedDeviceId === 'unassigned'
                                  ? 'text-[#3478F6] font-semibold'
                                  : 'text-[#758198]'
                              }`}
                            >
                              <span>Not Assigned</span>
                              {app.assignedDeviceId === 'unassigned' && (
                                <Check className="w-3.5 h-3.5 text-[#3478F6] shrink-0" />
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Row 2: Quick Mute + Volume Slider + Live VU Meter + Percentage */}
                    <div
                      onWheel={(e) => {
                        e.stopPropagation();
                        const delta = e.deltaY < 0 ? 2 : -2;
                        onChangeAppVolume(app.id, Math.max(0, Math.min(100, app.volume + delta)));
                      }}
                      className="mt-2 flex items-center gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => onToggleAppMute(app.id)}
                        title={app.muted ? `Unmute ${displayAppName}` : `Mute ${displayAppName}`}
                        className={`p-1 rounded-[7px] transition-colors cursor-pointer shrink-0 ${
                          app.muted
                            ? 'bg-rose-500/12 text-rose-600'
                            : 'text-[#758198] hover:text-[#172033] hover:bg-[#F5F8FF]'
                        }`}
                        aria-label={
                          app.muted ? `Unmute ${displayAppName}` : `Mute ${displayAppName}`
                        }
                      >
                        {app.muted || app.volume === 0 ? (
                          <VolumeX className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <div
                        onDoubleClick={() => onChangeAppVolume(app.id, 85)}
                        title="Drag or scroll wheel to adjust volume (Double-click for 85%)"
                        className="relative flex-1 flex flex-col justify-center h-5"
                      >
                        {/* Volume Track + Live Bouncing Peak Overlay */}
                        <div className="w-full h-[6px] rounded-full bg-[#E3EAF6] overflow-hidden relative pointer-events-none">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${app.muted ? 0 : app.volume}%`,
                              background: isUnassigned
                                ? '#94A3B8'
                                : 'linear-gradient(90deg, #3478F6 0%, #70A5FF 100%)',
                            }}
                          />
                          {/* Smooth 75ms ease-out peak overlay inside slider bar */}
                          <div
                            className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
                            style={{
                              width: `${sliderOverlayPct}%`,
                              opacity: isPeakActive ? 0.85 : 0,
                              background: getMeterBarGradient(rawPeak),
                              transition:
                                'width 75ms ease-out, background-color 0.1s ease, opacity 75ms ease-out',
                            }}
                          />
                        </div>

                        {/* Dedicated Slim Real-Time VU Meter Bar directly under the slider */}
                        <div className="w-full h-[3px] mt-[3px] rounded-full bg-[#E3EAF6]/60 overflow-hidden pointer-events-none">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${peakWidthPct}%`,
                              opacity: isPeakActive ? 1 : 0,
                              background: getMeterBarGradient(rawPeak),
                              boxShadow: isPeakActive
                                ? '0 0 6px rgba(22, 163, 106, 0.45)'
                                : 'none',
                              transition:
                                'width 75ms ease-out, background-color 0.1s ease, opacity 75ms ease-out',
                            }}
                          />
                        </div>

                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={app.muted ? 0 : app.volume}
                          onChange={(e) => onChangeAppVolume(app.id, Number(e.target.value))}
                          className="soundflow-slider absolute inset-0 w-full h-full"
                          aria-label={`${displayAppName} volume`}
                        />
                      </div>

                      <span className="w-8 text-right text-[11px] font-mono tabular-nums text-[#758198] font-medium shrink-0">
                        {app.muted ? 'Mute' : `${app.volume}%`}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 4. Compact Popup Footer */}
        <div
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.55)' }}
          className="px-4 py-2.5 border-t border-[#172033]/[0.06] flex items-center justify-between text-[11.5px] shrink-0"
        >
          <button
            type="button"
            onClick={onToggleRoutingActive}
            className="flex items-center gap-1.5 text-[#758198] hover:text-[#172033] font-medium transition-colors cursor-pointer"
          >
            {routingActive ? (
              <>
                <Pause className="w-3 h-3 text-amber-500" />
                <span>Pause Routing</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 text-[#16A36A]" />
                <span>Resume Routing</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenAdvancedSettings}
            className="text-[#3478F6] hover:text-[#2563EB] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
          >
            <span>Advanced Settings</span>
          </button>
        </div>
      </div>
    );
  }
);
