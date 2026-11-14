"use client";

import { useState, useRef, type RefObject } from "react";

// Reusable video player for the app's PUBLIC R2-streamed videos. The
// caller controls framing entirely via videoClassName (16:9 landing video
// vs the 9:16 portrait reel get different boxes), optionally adds chapter
// jump-to buttons, and can switch on muted autoplay-loop for short reels.
// Degrades to a text placeholder when the asset is unavailable (R2 not
// configured or the object not uploaded in this environment).

export interface VideoChapter {
  label: string;
  timeLabel: string;
  seconds: number;
}

interface VideoPlayerProps {
  src: string;
  alt?: string;
  /** Sizing/framing for the <video> element itself (aspect, rounding, ring). */
  videoClassName?: string;
  /**
   * Sizing for the player's OWN wrapper div — the video's percentage
   * heights (e.g. h-full) resolve against THIS wrapper, so a height cap
   * must live here rather than on an outer sibling div (the video would
   * otherwise ignore it and render at intrinsic size, overflowing the
   * page — the original portrait-reel bug).
   */
  wrapperClassName?: string;
  chapters?: VideoChapter[];
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  fallback?: string;
}

const DEFAULT_VIDEO_CLASS =
  "w-full aspect-video object-cover rounded-2xl bg-midnight-900 ring-1 ring-white/10 shadow-2xl";

export default function VideoPlayer({
  src,
  alt = "Vertex International video",
  videoClassName = DEFAULT_VIDEO_CLASS,
  wrapperClassName = "",
  chapters,
  autoPlay = false,
  muted = false,
  loop = false,
  controls = true,
  fallback = "Video unavailable — book a consultation with our team.",
}: VideoPlayerProps) {
  const [failed, setFailed] = useState(false);
  const videoRef: RefObject<HTMLVideoElement | null> = useRef(null);

  const jumpTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    void video.play().catch(() => {});
  };

  if (failed) {
    return (
      <div className="w-full aspect-video rounded-2xl bg-midnight-900 ring-1 ring-white/10 flex items-center justify-center text-ivory-50/50 text-sm px-6 text-center">
        {fallback}
      </div>
    );
  }

  return (
    <div className={wrapperClassName}>
      <video
        ref={videoRef}
        className={videoClassName}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
        preload="metadata"
        src={src}
        onError={() => setFailed(true)}
        aria-label={alt}
      />
      {chapters && chapters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-50/40 mr-1">Jump to:</span>
          {chapters.map((ch) => (
            <button
              key={ch.seconds}
              onClick={() => jumpTo(ch.seconds)}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-ivory-50/80 hover:border-gold-400 hover:text-gold-300 transition-colors"
            >
              {ch.label}
              <span className="text-[11px] font-semibold text-gold-300 tracking-wide">{ch.timeLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}