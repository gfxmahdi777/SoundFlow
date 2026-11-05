import {
  AppAudioSession,
  AudioOutputDevice,
  AudioTelemetryFrame,
} from '../types/soundflow';

interface AppAudioGraphNode {
  appId: string;
  sourceGain: GainNode;       // Controls app playback on/off
  volumeGain: GainNode;       // Controls app volume (0-100) and app mute
  analyser: AnalyserNode;     // Measures per-app RMS dB and waveform
  routedBusGain: GainNode;    // Connects into the target device bus
  currentConnectedDeviceId: string | null;
  oscillators: OscillatorNode[];
  intervalId: number | null;
}

interface DeviceBusNode {
  deviceId: string;
  busInputGain: GainNode;
  deviceVolumeGain: GainNode;
  analyser: AnalyserNode;
  stereoPanner: StereoPannerNode;
  filterNode: BiquadFilterNode;
  mediaDest?: MediaStreamAudioDestinationNode;
  audioElement?: HTMLAudioElement;
}

/**
 * SoundFlow Real-Time Multi-Application Web Audio Engine
 * Separates UI state from real-time DSP graph routing, per-app gain staging,
 * per-device buses, hardware setSinkId binding, and smooth RMS dBFS metering.
 */
export class SoundFlowAudioEngine {
  private ctx: AudioContext | null = null;
  private masterMonitorGain: GainNode | null = null;
  private isAudibleMonitorEnabled: boolean = false;
  private routingActive: boolean = true;
  private defaultDeviceId: string = 'dev-usb-speaker';

  private appNodes: Map<string, AppAudioGraphNode> = new Map();
  private deviceBuses: Map<string, DeviceBusNode> = new Map();

  private currentDevices: AudioOutputDevice[] = [];
  private currentApps: AppAudioSession[] = [];

  private timeDomainBuffer = new Float32Array(128);

  public async init(): Promise<boolean> {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });
      this.masterMonitorGain = this.ctx.createGain();
      this.masterMonitorGain.gain.value = this.isAudibleMonitorEnabled ? 0.32 : 0.0001;
      this.masterMonitorGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Will resume on next user gesture
      }
    }

    this.syncGraph(
      this.currentDevices,
      this.currentApps,
      this.routingActive,
      this.defaultDeviceId
    );
    return this.ctx.state === 'running';
  }

  public setAudibleMonitor(enabled: boolean): void {
    this.isAudibleMonitorEnabled = enabled;
    if (!this.ctx) {
      if (enabled) {
        void this.init();
      }
      return;
    }
    if (enabled && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    if (this.masterMonitorGain && this.ctx) {
      const now = this.ctx.currentTime;
      const target = enabled ? 0.32 : 0.0001;
      this.masterMonitorGain.gain.cancelScheduledValues(now);
      this.masterMonitorGain.gain.setTargetAtTime(target, now, 0.02);
    }
  }

  public getAudibleMonitor(): boolean {
    return this.isAudibleMonitorEnabled;
  }

  /**
   * Zero-latency direct gain update for smooth 60fps volume slider dragging
   */
  public setAppVolumeFast(appId: string, volume: number, muted: boolean): void {
    const targetApp = this.currentApps.find((a) => a.id === appId);
    if (targetApp) {
      targetApp.volume = volume;
      targetApp.muted = muted;
    }

    if (!this.ctx) return;
    const node = this.appNodes.get(appId);
    if (!node) return;

    const now = this.ctx.currentTime;
    const volTarget = muted ? 0.0 : Math.pow(Math.max(0, Math.min(100, volume)) / 100, 1.5);
    node.volumeGain.gain.cancelScheduledValues(now);
    node.volumeGain.gain.setTargetAtTime(volTarget, now, 0.012);
  }

  public async enumeratePhysicalSinks(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'audiooutput');
    } catch {
      return [];
    }
  }

  public async bindHardwareSink(deviceId: string, hardwareSinkId: string): Promise<boolean> {
    const bus = this.deviceBuses.get(deviceId);
    if (!bus || !this.ctx) return false;

    try {
      if (!bus.mediaDest) {
        bus.mediaDest = this.ctx.createMediaStreamDestination();
        bus.deviceVolumeGain.connect(bus.mediaDest);
        bus.audioElement = new Audio();
        bus.audioElement.srcObject = bus.mediaDest.stream;
      }

      const audioEl = bus.audioElement as HTMLAudioElement & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };

      if (audioEl && typeof audioEl.setSinkId === 'function') {
        await audioEl.setSinkId(hardwareSinkId);
        await audioEl.play();
        return true;
      }
    } catch (err) {
      console.warn('Hardware sink binding fell back to Web Audio bus:', err);
    }
    return false;
  }

  /**
   * Resolves which connected device an application should currently route to.
   */
  public resolveEffectiveDeviceId(
    app: AppAudioSession,
    devices: AudioOutputDevice[],
    defaultDeviceId: string,
    routingActive: boolean
  ): string | null {
    if (!routingActive) return null;
    if (app.assignedDeviceId === 'unassigned') return null;

    const targetId = app.assignedDeviceId === 'default' ? defaultDeviceId : app.assignedDeviceId;
    const targetDevice = devices.find((d) => d.id === targetId);

    if (targetDevice && targetDevice.status === 'connected') {
      return targetDevice.id;
    }

    // Fallback to current connected default device if assigned device is disconnected
    const fallbackDefault =
      devices.find((d) => d.id === defaultDeviceId && d.status === 'connected') ||
      devices.find((d) => d.status === 'connected');

    return fallbackDefault ? fallbackDefault.id : null;
  }

  public syncGraph(
    devices: AudioOutputDevice[],
    apps: AppAudioSession[],
    routingActive: boolean,
    defaultDeviceId: string
  ): void {
    this.currentDevices = devices;
    this.currentApps = apps;
    this.routingActive = routingActive;
    this.defaultDeviceId = defaultDeviceId;

    if (!this.ctx || !this.masterMonitorGain) return;

    const now = this.ctx.currentTime;

    // 1. Ensure Device Buses exist & update their parameters
    const activeDeviceIds = new Set(devices.map((d) => d.id));
    for (const [id, bus] of this.deviceBuses.entries()) {
      if (!activeDeviceIds.has(id)) {
        try {
          bus.busInputGain.disconnect();
          bus.deviceVolumeGain.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        this.deviceBuses.delete(id);
      }
    }

    for (const device of devices) {
      let bus = this.deviceBuses.get(device.id);
      if (!bus) {
        bus = this.createDeviceBus(device);
        this.deviceBuses.set(device.id, bus);
      }

      const isConnected = device.status === 'connected';
      const targetGain = isConnected && !device.muted ? device.masterVolume / 100 : 0;
      bus.deviceVolumeGain.gain.cancelScheduledValues(now);
      bus.deviceVolumeGain.gain.setTargetAtTime(targetGain, now, 0.015);
    }

    // 2. Remove stopped/closed applications from the audio graph
    const activeAppIds = new Set(apps.map((a) => a.id));
    for (const [appId, node] of this.appNodes.entries()) {
      if (!activeAppIds.has(appId)) {
        this.destroyAppNode(node);
        this.appNodes.delete(appId);
      }
    }

    // 3. Create or update application audio generators & route to effective device bus
    for (const app of apps) {
      let appNode = this.appNodes.get(app.id);
      if (!appNode) {
        appNode = this.createAppGenerator(app);
        this.appNodes.set(app.id, appNode);
      }

      // Play/pause state of the app source
      const sourceTarget = app.isPlaying ? 1.0 : 0.0;
      appNode.sourceGain.gain.cancelScheduledValues(now);
      appNode.sourceGain.gain.setTargetAtTime(sourceTarget, now, 0.02);

      // Volume & quick mute control
      const volTarget = app.muted ? 0.0 : Math.pow(app.volume / 100, 1.5);
      appNode.volumeGain.gain.cancelScheduledValues(now);
      appNode.volumeGain.gain.setTargetAtTime(volTarget, now, 0.015);

      // Resolve target output device bus
      const effectiveDeviceId = this.resolveEffectiveDeviceId(
        app,
        devices,
        defaultDeviceId,
        routingActive
      );

      if (appNode.currentConnectedDeviceId !== effectiveDeviceId) {
        try {
          appNode.routedBusGain.disconnect();
        } catch {
          // Ignore disconnect errors
        }

        if (effectiveDeviceId) {
          const targetBus = this.deviceBuses.get(effectiveDeviceId);
          if (targetBus) {
            appNode.routedBusGain.connect(targetBus.busInputGain);
          }
        }
        appNode.currentConnectedDeviceId = effectiveDeviceId;
      }
    }
  }

  private createDeviceBus(device: AudioOutputDevice): DeviceBusNode {
    const ctx = this.ctx!;
    const busInputGain = ctx.createGain();
    const filterNode = ctx.createBiquadFilter();
    const stereoPanner = ctx.createStereoPanner();
    const deviceVolumeGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;

    if (device.formFactor === 'headphones') {
      filterNode.type = 'peaking';
      filterNode.frequency.value = 3200;
      filterNode.gain.value = 2.5;
      stereoPanner.pan.value = -0.25;
    } else if (device.formFactor === 'speakers') {
      filterNode.type = 'lowshelf';
      filterNode.frequency.value = 180;
      filterNode.gain.value = 3.0;
      stereoPanner.pan.value = 0.25;
    } else if (device.formFactor === 'dac') {
      filterNode.type = 'highshelf';
      filterNode.frequency.value = 6500;
      filterNode.gain.value = 2.0;
      stereoPanner.pan.value = 0.0;
    } else {
      filterNode.type = 'allpass';
      stereoPanner.pan.value = 0.1;
    }

    busInputGain.connect(filterNode);
    filterNode.connect(stereoPanner);
    stereoPanner.connect(deviceVolumeGain);
    deviceVolumeGain.connect(analyser);
    analyser.connect(this.masterMonitorGain!);

    return {
      deviceId: device.id,
      busInputGain,
      deviceVolumeGain,
      analyser,
      stereoPanner,
      filterNode,
    };
  }

  private createAppGenerator(app: AppAudioSession): AppAudioGraphNode {
    const ctx = this.ctx!;
    const sourceGain = ctx.createGain();
    const volumeGain = ctx.createGain();
    const analyser = ctx.createAnalyser();
    const routedBusGain = ctx.createGain();

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.76;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;

    const envGain = ctx.createGain();
    envGain.gain.value = 0.15;

    const profileMap: Record<
      string,
      { freqs: [number, number]; pattern: number[]; tempoMs: number; wave: OscillatorType }
    > = {
      chrome: {
        freqs: [261.63, 329.63],
        pattern: [261.63, 293.66, 329.63, 392.0, 329.63, 293.66],
        tempoMs: 420,
        wave: 'triangle',
      },
      'after-effects': {
        freqs: [440.0, 554.37],
        pattern: [440.0, 554.37, 659.25, 880.0, 659.25, 554.37],
        tempoMs: 280,
        wave: 'sine',
      },
      game: {
        freqs: [110.0, 164.81],
        pattern: [110.0, 123.47, 130.81, 164.81, 146.83, 110.0],
        tempoMs: 220,
        wave: 'sawtooth',
      },
      vlc: {
        freqs: [196.0, 246.94],
        pattern: [196.0, 220.0, 246.94, 293.66, 329.63, 246.94],
        tempoMs: 520,
        wave: 'triangle',
      },
      spotify: {
        freqs: [349.23, 440.0],
        pattern: [349.23, 392.0, 440.0, 523.25, 440.0, 392.0],
        tempoMs: 340,
        wave: 'sine',
      },
      discord: {
        freqs: [220.0, 277.18],
        pattern: [220.0, 246.94, 207.65, 261.63, 196.0, 220.0],
        tempoMs: 310,
        wave: 'triangle',
      },
      obs: {
        freqs: [146.83, 220.0],
        pattern: [146.83, 174.61, 220.0, 261.63, 220.0, 174.61],
        tempoMs: 380,
        wave: 'sine',
      },
    };

    const profile = profileMap[app.iconType] || profileMap.chrome;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = profile.wave;
    osc2.type = 'sine';
    osc1.frequency.value = profile.freqs[0];
    osc2.frequency.value = profile.freqs[1];

    osc1.connect(envGain);
    osc2.connect(envGain);
    envGain.connect(filter);
    filter.connect(sourceGain);

    sourceGain.connect(volumeGain);
    volumeGain.connect(analyser);
    analyser.connect(routedBusGain);

    osc1.start();
    osc2.start();

    let step = 0;
    const intervalId = window.setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      try {
        const t = this.ctx.currentTime;
        const nextFreq = profile.pattern[step % profile.pattern.length];
        step++;

        osc1.frequency.setTargetAtTime(nextFreq, t, 0.04);
        osc2.frequency.setTargetAtTime(nextFreq * 1.25, t, 0.05);

        const pulsePeak = 0.14 + ((step * 37) % 10) * 0.012;
        envGain.gain.cancelScheduledValues(t);
        envGain.gain.setTargetAtTime(pulsePeak, t, 0.015);
        envGain.gain.setTargetAtTime(0.05, t + 0.04, (profile.tempoMs / 1000) * 0.45);
      } catch {
        // Safe against timing edge cases
      }
    }, profile.tempoMs);

    return {
      appId: app.id,
      sourceGain,
      volumeGain,
      analyser,
      routedBusGain,
      currentConnectedDeviceId: null,
      oscillators: [osc1, osc2],
      intervalId,
    };
  }

  private destroyAppNode(node: AppAudioGraphNode): void {
    if (node.intervalId !== null) {
      window.clearInterval(node.intervalId);
    }
    for (const osc of node.oscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Ignore stop errors
      }
    }
    try {
      node.sourceGain.disconnect();
      node.volumeGain.disconnect();
      node.analyser.disconnect();
      node.routedBusGain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }

  /**
   * Computes a real-time telemetry frame from active Web Audio AnalyserNodes
   */
  public getTelemetryFrame(): AudioTelemetryFrame {
    const appLevels: AudioTelemetryFrame['appLevels'] = {};
    const deviceLevels: AudioTelemetryFrame['deviceLevels'] = {};
    const nowMs = performance.now();

    for (const device of this.currentDevices) {
      deviceLevels[device.id] = {
        db: -60,
        peak: 0,
        activeStreamCount: 0,
      };
    }

    const isCtxRunning = this.ctx && this.ctx.state === 'running';

    for (let i = 0; i < this.currentApps.length; i++) {
      const app = this.currentApps[i];
      const effectiveDeviceId = this.resolveEffectiveDeviceId(
        app,
        this.currentDevices,
        this.defaultDeviceId,
        this.routingActive
      );

      if (
        effectiveDeviceId &&
        deviceLevels[effectiveDeviceId] &&
        app.isPlaying &&
        !app.muted &&
        app.volume > 0
      ) {
        deviceLevels[effectiveDeviceId].activeStreamCount += 1;
      }

      const node = this.appNodes.get(app.id);

      if (!app.isPlaying || app.muted || app.volume === 0) {
        appLevels[app.id] = {
          db: -60,
          peak: 0,
          waveform: new Array(16).fill(0),
          effectiveDeviceId,
        };
        continue;
      }

      if (isCtxRunning && node) {
        node.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
        let sumSquares = 0;
        const waveform: number[] = [];
        const stride = Math.floor(this.timeDomainBuffer.length / 16);

        for (let j = 0; j < this.timeDomainBuffer.length; j++) {
          const sample = this.timeDomainBuffer[j];
          sumSquares += sample * sample;
          if (j % stride === 0 && waveform.length < 16) {
            waveform.push(Math.max(-1, Math.min(1, sample * 4.5)));
          }
        }

        const rms = Math.sqrt(sumSquares / this.timeDomainBuffer.length);
        const normalizedPeak = Math.min(1, Math.max(0, rms * 5.2));
        const db =
          normalizedPeak > 0.001 ? Math.max(-60, 20 * Math.log10(normalizedPeak)) : -60;

        appLevels[app.id] = {
          db: Number(db.toFixed(1)),
          peak: normalizedPeak,
          waveform,
          effectiveDeviceId,
        };
      } else {
        const phase = nowMs * 0.0055 + i * 1.7;
        const mod = 0.55 + 0.32 * Math.sin(phase) * Math.cos(phase * 0.7);
        const scaledPeak = Math.min(1, (app.volume / 100) * mod);
        const db = scaledPeak > 0.001 ? Math.max(-60, 20 * Math.log10(scaledPeak)) : -60;
        const waveform = Array.from({ length: 16 }, (_, k) =>
          Number((Math.sin(phase + k * 0.55) * scaledPeak * 0.85).toFixed(2))
        );

        appLevels[app.id] = {
          db: Number(db.toFixed(1)),
          peak: scaledPeak,
          waveform,
          effectiveDeviceId,
        };
      }

      if (effectiveDeviceId && deviceLevels[effectiveDeviceId]) {
        const currentDev = deviceLevels[effectiveDeviceId];
        const devObj = this.currentDevices.find((d) => d.id === effectiveDeviceId);
        const devScale = devObj && !devObj.muted ? devObj.masterVolume / 100 : 0;
        const combinedPeak = Math.min(
          1,
          Math.hypot(currentDev.peak, appLevels[app.id].peak * devScale)
        );
        currentDev.peak = combinedPeak;
        currentDev.db =
          combinedPeak > 0.001
            ? Number(Math.max(-60, 20 * Math.log10(combinedPeak)).toFixed(1))
            : -60;
      }
    }

    return {
      appLevels,
      deviceLevels,
      engineLatencyMs: this.ctx
        ? Math.round((this.ctx.baseLatency || 0.0048) * 1000 * 10) / 10
        : 4.8,
      sampleRateHz: this.ctx ? this.ctx.sampleRate : 48000,
      audioContextState: this.ctx ? this.ctx.state : 'suspended',
    };
  }
}

export const soundFlowEngine = new SoundFlowAudioEngine();
