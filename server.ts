import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE_PATH = path.join(__dirname, 'soundflow-config.json');

const DEFAULT_CONFIG = {
  routingActive: true,
  defaultDeviceId: 'dev-usb-speaker',
  launchAtStartup: true,
  minimizeToTray: true,
  autoRestoreOnReconnect: true,
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

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('Error loading soundflow-config.json:', err);
  }
  return DEFAULT_CONFIG;
}

function saveConfig(config: unknown) {
  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving soundflow-config.json:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'SoundFlow Audio Engine Persistence Service' });
  });

  app.get('/api/config', (_req, res) => {
    const config = loadConfig();
    res.json(config);
  });

  app.post('/api/config', (req, res) => {
    const current = loadConfig();
    const updated = {
      ...current,
      ...req.body,
      updatedAt: new Date().toISOString(),
    };
    saveConfig(updated);
    res.json(updated);
  });

  app.post('/api/config/reset', (_req, res) => {
    saveConfig(DEFAULT_CONFIG);
    res.json(DEFAULT_CONFIG);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SoundFlow server listening on http://localhost:${PORT}`);
  });
}

startServer();
