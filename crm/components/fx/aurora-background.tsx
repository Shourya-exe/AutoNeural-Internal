"use client";

import { useEffect, useRef } from "react";

/**
 * Full-screen animated burgundy aurora rendered with a WebGL fragment shader.
 * - Rendered at reduced resolution and stretched (it is soft by nature) to stay cheap.
 * - Pauses while the tab is hidden; drifts at a third of the speed for prefers-reduced-motion.
 * - Falls back to the CSS gradient underneath when WebGL is unavailable.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uIntensity;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

// A flowing silk ribbon: a soft tinted fold with a brighter crease where light catches it.
vec3 ribbon(vec2 p, float t, float y0, float amp, float freq, float speed, float width, vec3 tint, vec3 crease, out float body, out float edge) {
  float y = y0 + amp * sin(p.x * freq + t * speed) + 0.35 * amp * sin(p.x * freq * 2.3 - t * speed * 1.7);
  float d = p.y - y;
  body = exp(-d * d / (width * width));
  edge = exp(-pow((d - width * 0.55) / (width * 0.12), 2.0));
  float shimmer = 0.55 + 0.45 * sin(p.x * 6.0 - t * speed * 3.0);
  edge *= shimmer;
  return mix(tint, crease, edge);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  p += uMouse * 0.12;
  float t = uTime;

  // Warm white palette with maroon. Light theme: the ground is bright and every layer
  // TINTS it (mix towards a warmer/deeper hue) instead of adding light to black.
  vec3 ivory  = vec3(0.985, 0.965, 0.942);   // #FBF6F0
  vec3 sand   = vec3(0.957, 0.906, 0.859);   // #F4E7DB
  vec3 blush  = vec3(0.925, 0.831, 0.816);   // #ECD4D0
  vec3 dusty  = vec3(0.831, 0.663, 0.667);   // #D4A9AA
  vec3 maroon = vec3(0.549, 0.110, 0.169);   // #8C1C2B
  vec3 white  = vec3(1.0);

  // Flowing silk: domain-warped noise that visibly drifts and folds.
  float ft = t * 0.12;
  vec2 q = vec2(fbm(p * 1.3 + vec2(0.0, ft)), fbm(p * 1.3 + vec2(5.2, 1.3 - ft)));
  vec2 r = vec2(fbm(p * 1.7 + 2.8 * q + vec2(1.7, 9.2) + ft * 1.6),
                fbm(p * 1.7 + 2.8 * q + vec2(8.3, 2.8) - ft * 1.2));
  float f = fbm(p * 1.1 + 2.4 * r);

  vec3 col = mix(ivory, sand, smoothstep(0.05, 0.8, f));
  col = mix(col, blush, smoothstep(0.25, 0.95, length(q)) * 0.9 * uIntensity);
  col = mix(col, dusty, smoothstep(0.5, 1.0, r.x) * 0.65 * uIntensity);
  col = mix(col, mix(dusty, maroon, 0.35), smoothstep(0.72, 1.1, f + r.y * 0.5) * 0.35 * uIntensity);
  // Silk sheen: thin brighter folds, like light along a crease.
  float fold = smoothstep(0.02, 0.0, abs(f - 0.62)) + smoothstep(0.015, 0.0, abs(f - 0.48)) * 0.6;
  col = mix(col, white, fold * 0.5);

  // Drifting soft colour pools (slow Lissajous paths).
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(0.75 * sin(t * (0.07 + fi * 0.025) + fi * 2.1), 0.42 * cos(t * (0.09 + fi * 0.02) + fi * 1.3));
    float d = length(p - c);
    vec3 pool = i == 1 ? white : (i == 2 ? blush : mix(dusty, maroon, 0.3));
    col = mix(col, pool, exp(-d * d * 3.2) * 0.55 * uIntensity);
  }

  // Three silk ribbons sweeping across, tinted maroon-rose with a bright crease.
  float b1, e1, b2, e2, b3, e3;
  vec3 c1 = ribbon(p, t, 0.28, 0.12, 1.6, 0.5, 0.12, mix(dusty, maroon, 0.25), white, b1, e1);
  vec3 c2 = ribbon(p, t + 20.0, -0.05, 0.15, 1.2, -0.38, 0.15, blush, white, b2, e2);
  vec3 c3 = ribbon(p, t + 40.0, -0.36, 0.10, 2.0, 0.62, 0.09, mix(dusty, maroon, 0.45), white, b3, e3);
  col = mix(col, c1, clamp(b1 * 0.85 + e1 * 0.5, 0.0, 1.0) * uIntensity);
  col = mix(col, c2, clamp(b2 * 0.7 + e2 * 0.45, 0.0, 1.0) * uIntensity);
  col = mix(col, c3, clamp(b3 * 0.8 + e3 * 0.45, 0.0, 1.0) * uIntensity);

  // Drifting motes: fine warm dust, lighter and darker specks so they read on white.
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    float scale = 26.0 + fl * 18.0;
    vec2 g = p * scale;
    g.y -= t * (0.55 + fl * 0.35);                      // rise
    g.x += sin(g.y * 0.35 + fl * 3.0 + t * 0.4) * 0.45; // sway
    vec2 id = floor(g);
    float h = hash(id + fl * 17.0);
    if (h > 0.93) {
      vec2 c = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
      float tw = 0.55 + 0.45 * sin(t * (1.2 + h * 3.0) + h * 60.0);
      float size = 0.07 + 0.06 * hash(id + 9.3);
      float m = smoothstep(size, 0.0, length(c)) * tw * (0.8 - fl * 0.25);
      col = mix(col, h > 0.965 ? white : mix(dusty, maroon, 0.5), m);
    }
  }

  // A slow diagonal sheen, like light moving across silk.
  float sweep = fract(t * 0.045);
  float band = exp(-pow((uv.x + uv.y * 0.6 - (sweep * 2.6 - 0.5)) * 5.0, 2.0));
  col = mix(col, white, band * 0.55 * uIntensity);

  // Interactive: a soft maroon halo follows the cursor.
  float cursor = exp(-length(p - uMouse * vec2(2.0, 2.0)) * 2.4);
  col = mix(col, mix(dusty, maroon, 0.3), cursor * 0.3);

  // Warm vignette: edges settle into deeper sand, centre stays bright.
  float v = smoothstep(1.45, 0.25, length(p * vec2(0.8, 1.05)));
  col = mix(mix(sand, dusty, 0.35), col, mix(0.55, 1.0, v));
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn("[aurora] shader error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export function AuroraBackground({
  intensity = 1,
  className = "",
}: {
  /** 0–1.5: how much crimson/rose light shows through. */
  intensity?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    // No WebGL, or a context that was already lost: keep the CSS gradient fallback.
    if (!gl || gl.isContextLost()) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uIntensity = gl.getUniformLocation(prog, "uIntensity");
    gl.uniform1f(uIntensity, intensity);

    // Soft by design, so render at ~half resolution and let CSS scale it up.
    const scale = 0.6 * Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = Math.max(1, Math.floor(canvas.clientWidth * scale));
      const h = Math.max(1, Math.floor(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = e.clientX / window.innerWidth - 0.5;
      mouse.ty = 0.5 - e.clientY / window.innerHeight;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now() - 60_000; // start mid-flow, not from a blank state
    let raf = 0;
    const frame = (now: number) => {
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      // With "reduce motion" on, the background keeps drifting but at a third of the speed.
      gl.uniform1f(uTime, ((now - start) / 1000) * (reduced ? 0.33 : 1));
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };
    document.addEventListener("visibilitychange", onVisibility);
    // If the GPU drops the context (driver reset, too many contexts), hide the canvas so the
    // CSS gradient shows instead of a blank/white rectangle.
    const onLost = (e: Event) => {
      e.preventDefault();
      cancelAnimationFrame(raf);
      canvas.style.opacity = "0";
    };
    canvas.addEventListener("webglcontextlost", onLost);
    raf = requestAnimationFrame(frame);
    canvas.style.opacity = "1";

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      // Deliberately NOT calling WEBGL_lose_context here: React re-runs effects on the same
      // canvas (StrictMode, fast refresh), and getContext() would then return the dead context.
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [intensity]);

  return (
    <div aria-hidden className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-wine-900 ${className}`}>
      {/* CSS fallback / first paint before WebGL starts */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_20%_10%,rgba(236,212,208,0.85),transparent_60%),radial-gradient(ellipse_70%_60%_at_85%_80%,rgba(244,231,219,0.9),transparent_60%),radial-gradient(ellipse_50%_40%_at_60%_40%,rgba(140,28,43,0.06),transparent_70%)]" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-1000"
      />
      <div className="grain absolute inset-0" />
    </div>
  );
}
