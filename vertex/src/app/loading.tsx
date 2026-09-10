import React from 'react';

export default function Loading() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/90 backdrop-blur-md transition-all duration-300">
      <div className="flex flex-col items-center justify-center relative">
        {/* Soft, pulsing radiant background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 bg-gradient-to-tr from-emerald-400/20 to-amber-400/20 rounded-full blur-[40px] animate-pulse" style={{ animationDuration: '3s' }} />

        {/* Sophisticated Logo container with orbital rings */}
        <div className="relative flex items-center justify-center w-36 h-36 mb-10">
          {/* Subtle static track */}
          <div className="absolute inset-0 rounded-full border-2 border-emerald-50 opacity-50" />
          
          {/* Dynamic outer orbit */}
          <div 
            className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-emerald-500 border-r-emerald-500/30" 
            style={{ animation: 'spin 2s ease-in-out infinite' }} 
          />
          
          {/* Smooth inner orbit */}
          <div 
            className="absolute inset-3 rounded-full border-[3px] border-transparent border-b-amber-500 border-l-amber-500/30" 
            style={{ animation: 'spin 3s linear infinite reverse' }} 
          />
               
          {/* Center Logo with heartbeat scale */}
          <img
            src="/logo.svg"
            alt="Vertex Loading..."
            className="h-16 w-auto relative z-10 brightness-0 drop-shadow-md"
            style={{ animation: 'pulse-scale 2s ease-in-out infinite' }}
          />
        </div>

        {/* Modern progress indicator area */}
        <div className="flex flex-col items-center gap-4">
          {/* Dynamic Loading Text */}
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-800 text-sm font-bold tracking-[0.35em] uppercase" style={{ textShadow: '0 2px 10px rgba(16, 185, 129, 0.2)' }}>
              Loading Vertex
            </span>
            <span className="flex gap-1 ml-1">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce shadow-[0_0_8px_rgba(245,158,11,0.6)]" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce shadow-[0_0_8px_rgba(245,158,11,0.6)]" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce shadow-[0_0_8px_rgba(245,158,11,0.6)]" style={{ animationDelay: '300ms' }} />
            </span>
          </div>

          {/* Glowing Shimmering Progress Bar */}
          <div className="w-64 h-1.5 bg-emerald-100/50 rounded-full overflow-hidden relative shadow-inner">
            <div 
              className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-600 to-amber-400 shadow-[0_0_10px_rgba(16,185,129,0.5)]"
              style={{ 
                animation: 'progress-shimmer 2s ease-in-out infinite',
              }}
            />
          </div>
        </div>

        {/* Custom precise animations for the loader */}
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes pulse-scale {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
          @keyframes progress-shimmer {
            0% { transform: translateX(-100%); width: 20%; }
            50% { transform: translateX(50%); width: 80%; }
            100% { transform: translateX(250%); width: 20%; }
          }
        `}} />
      </div>
    </div>
  );
}
