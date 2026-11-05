import React from 'react';
import { AppIconType, DeviceFormFactor } from '../types/soundflow';
import {
  Headphones,
  Speaker,
  Monitor,
  Cpu,
} from 'lucide-react';

export const SoundFlowBrandIcon: React.FC<{ className?: string; size?: number }> = ({
  className = '',
  size = 22,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <defs>
      <linearGradient id="sf-brand-grad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3478F6" />
        <stop offset="100%" stopColor="#70A5FF" />
      </linearGradient>
    </defs>
    <rect width="28" height="28" rx="8" fill="url(#sf-brand-grad)" />
    <path
      d="M7 15.5V12.5M10.5 18.5V9.5M14 21V7M17.5 17.5V10.5M21 15.5V12.5"
      stroke="#FFFFFF"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  </svg>
);

export const ApplicationIcon: React.FC<{ type: AppIconType; className?: string }> = ({
  type,
  className = 'w-7 h-7',
}) => {
  switch (type) {
    case 'chrome':
      return (
        <div
          className={`${className} rounded-[8px] bg-[#EBF3FF] border border-[#3478F6]/20 shadow-xs flex items-center justify-center shrink-0`}
          title="Google Chrome"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#3478F6" strokeWidth="2.2" />
            <circle cx="12" cy="12" r="3.8" fill="#16A36A" />
            <path d="M12 8.2H20M8.7 13.9L4.7 7M15.3 13.9L11.3 20.8" stroke="#70A5FF" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'after-effects':
      return (
        <div
          className={`${className} rounded-[8px] bg-[#EEF0FF] border border-[#5B63F6]/25 shadow-xs flex items-center justify-center shrink-0 font-display font-bold text-[11px] tracking-tight text-[#434CE6]`}
          title="Adobe After Effects"
        >
          Ae
        </div>
      );
    case 'game':
      return (
        <div
          className={`${className} rounded-[8px] bg-[#EAF2FF] border border-[#3478F6]/25 shadow-xs flex items-center justify-center shrink-0`}
          title="Game (DirectX 12)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3478F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="12" x2="10" y2="12" />
            <line x1="8" y1="10" x2="8" y2="14" />
            <line x1="15" y1="13" x2="15.01" y2="13" />
            <line x1="18" y1="11" x2="18.01" y2="11" />
            <rect x="2" y="6" width="20" height="12" rx="4" />
          </svg>
        </div>
      );
    case 'vlc':
      return (
        <div
          className={`${className} rounded-[8px] bg-[#FFF4E8] border border-amber-500/25 shadow-xs flex items-center justify-center shrink-0`}
          title="VLC Media Player"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M9 4H15L18 19H6L9 4Z" stroke="#EA580C" strokeWidth="2" strokeLinejoin="round" />
            <path d="M7.5 11H16.5M6.8 15H17.2M4 19H20" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
      );
    case 'spotify':
      return (
        <div
          className={`${className} rounded-[8px] bg-[#E8F8F0] border border-[#16A36A]/25 shadow-xs flex items-center justify-center shrink-0`}
          title="Spotify"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16A36A" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9.5C10 8 15 8.5 18.5 10.5" />
            <path d="M7 13C10.2 11.8 14.2 12.2 17 13.8" />
            <path d="M8 16.2C10.5 15.3 13.5 15.6 15.5 16.8" />
          </svg>
        </div>
      );
    case 'discord':
      return (
        <div
          className={`${className} rounded-[8px] bg-[#EEF0FF] border border-[#5865F2]/25 shadow-xs flex items-center justify-center shrink-0`}
          title="Discord"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4F5BD5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="6" width="16" height="12" rx="4" />
            <circle cx="9.5" cy="12" r="1" fill="#4F5BD5" />
            <circle cx="14.5" cy="12" r="1" fill="#4F5BD5" />
          </svg>
        </div>
      );
    case 'obs':
    default:
      return (
        <div
          className={`${className} rounded-[8px] bg-[#EEF2F9] border border-[#172033]/15 shadow-xs flex items-center justify-center shrink-0`}
          title="OBS Studio"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#172033" strokeWidth="2">
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
      );
  }
};

export const DeviceEndpointIcon: React.FC<{ formFactor: DeviceFormFactor; className?: string }> = ({
  formFactor,
  className = 'w-4 h-4',
}) => {
  switch (formFactor) {
    case 'headphones':
      return <Headphones className={className} />;
    case 'speakers':
      return <Speaker className={className} />;
    case 'dac':
      return <Cpu className={className} />;
    case 'monitor':
    default:
      return <Monitor className={className} />;
  }
};
