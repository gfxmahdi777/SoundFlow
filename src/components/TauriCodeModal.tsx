import React, { useState } from 'react';
import { TAURI_RUST_FILES } from '../data/tauriRustSource';
import { X, Copy, Check, Download, Code2, Terminal } from 'lucide-react';
import { SoundFlowConfig } from '../types/soundflow';

interface TauriCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SoundFlowConfig;
}

export const TauriCodeModal: React.FC<TauriCodeModalProps> = ({
  isOpen,
  onClose,
  config,
}) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const currentFile = TAURI_RUST_FILES[selectedFileIndex];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentFile.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback
    }
  };

  const handleDownloadBundle = () => {
    const bundleContent = {
      project: 'SoundFlow — Windows System Tray Audio Controller (Tauri 2 + Rust WASAPI)',
      exportedAt: new Date().toISOString(),
      currentSavedRoutingConfig: config,
      tauriFiles: TAURI_RUST_FILES,
    };

    const blob = new Blob([JSON.stringify(bundleContent, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'soundflow-tauri2-wasapi-project.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadCurrentFile = () => {
    const filename = currentFile.path.split('/').pop() || 'file.rs';
    const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-[#172033]/25 backdrop-blur-md flex items-center justify-center p-4"
      role="dialog"
      aria-label="Tauri 2 Rust WASAPI Source Code Exporter"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.88)',
          borderColor: 'rgba(255, 255, 255, 0.92)',
        }}
        className="w-full max-w-4xl rounded-[18px] backdrop-blur-2xl border shadow-[0_24px_64px_rgba(23,32,51,0.18)] overflow-hidden flex flex-col max-h-[86vh] text-[#172033]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#172033]/[0.08] flex items-center justify-between bg-white/60">
          <div className="flex items-center gap-2.5">
            <Code2 className="w-4 h-4 text-[#3478F6]" />
            <div>
              <h2 className="font-display font-bold text-sm text-[#172033]">
                Tauri 2 + Rust (WASAPI / Windows Core Audio) Native Codebase
              </h2>
              <p className="text-[11.5px] text-[#758198]">
                Production Rust backend implementing IMMDeviceEnumerator, IAudioSessionManager2, IAudioPolicyConfig &amp; Native Tray
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadBundle}
              className="px-3 py-1.5 rounded-[10px] text-xs font-medium bg-[#3478F6] hover:bg-[#2563EB] text-white flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Full Tauri Bundle</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-[10px] bg-white/80 text-[#758198] hover:text-[#172033] border border-[#172033]/10 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* File Selector Tabs + Code Viewer */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {/* Sidebar File List */}
          <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[#172033]/[0.08] bg-[#F5F8FF]/80 p-3 space-y-1.5 shrink-0">
            <div className="text-[11px] font-semibold text-[#758198] px-2 py-1">
              Native Rust &amp; Tauri 2 Files
            </div>
            {TAURI_RUST_FILES.map((file, idx) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedFileIndex(idx)}
                className={`w-full text-left px-2.5 py-2 rounded-[10px] text-xs font-mono transition-colors cursor-pointer ${
                  selectedFileIndex === idx
                    ? 'bg-white text-[#3478F6] font-semibold border border-[#3478F6]/35 shadow-2xs'
                    : 'text-[#758198] hover:text-[#172033] hover:bg-white/60 border border-transparent'
                }`}
              >
                {file.path}
              </button>
            ))}

            <div className="pt-3 mt-3 border-t border-[#172033]/[0.08] px-2 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#172033]">
                <Terminal className="w-3.5 h-3.5 text-[#16A36A]" />
                <span>Windows Build Commands</span>
              </div>
              <pre className="p-2.5 rounded-[10px] bg-white border border-[#172033]/[0.08] text-[10.5px] font-mono text-[#758198] overflow-x-auto">
{`npm install
npx tauri dev
npx tauri build --bundles msi,nsis`}
              </pre>
            </div>
          </div>

          {/* Code Content Area */}
          <div className="flex-1 flex flex-col min-w-0 bg-white/75">
            <div className="px-4 py-2.5 bg-[#F5F8FF]/70 border-b border-[#172033]/[0.07] flex items-center justify-between gap-2">
              <p className="text-xs text-[#758198] truncate">{currentFile.description}</p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadCurrentFile}
                  className="px-2.5 py-1 rounded-[8px] bg-white hover:bg-[#F5F8FF] text-xs text-[#172033] border border-[#172033]/12 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  <Download className="w-3 h-3" />
                  <span>Download File</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-[8px] bg-white hover:bg-[#F5F8FF] text-xs text-[#172033] border border-[#172033]/12 flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-[#16A36A]" />
                      <span className="text-[#16A36A]">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <pre className="flex-1 p-4 overflow-auto text-xs font-mono leading-relaxed text-[#172033] soundflow-scroll">
              <code>{currentFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
