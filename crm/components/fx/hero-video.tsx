"use client";

import { useState } from "react";

/**
 * Looping, muted background video that fades in only once it can play, so whatever is
 * behind it (the WebGL aurora) shows while it loads. Hidden for prefers-reduced-motion
 * via the .hero-video rule in globals.css.
 */
export function HeroVideo({ src, className = "" }: { src: string; className?: string }) {
  const [ready, setReady] = useState(false);
  return (
    <video
      className={`hero-video ken-burns absolute inset-0 h-full w-full object-cover transition-opacity duration-[1500ms] ${
        ready ? "opacity-100" : "opacity-0"
      } ${className}`}
      src={src}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      onCanPlay={() => setReady(true)}
      onLoadedData={() => setReady(true)}
    />
  );
}
