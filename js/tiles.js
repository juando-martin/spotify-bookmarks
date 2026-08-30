// Copyright (c) 2026 Juan D. Martin
// Generated placeholder cover tiles.
//
// Spotify won't hand a Development-Mode app artwork for its editorial
// playlists (Discover Weekly, the Daily Mixes, most "…Mix" playlists), and a
// user's own playlists often have no cover either. Rather than a blank
// square, the bookmark list can draw its own tile from the playlist's id
// (fixes the colour/shape) and name (drawn on it).
//
// It's a pure function of those two strings plus the chosen style — computed
// on an offscreen canvas at render time and handed back as a data: URL that
// drops into the same <img> a real cover would use. Nothing is persisted, so
// changing the style in Settings just repaints every tile on the next render.

import { hashCode, monogram } from "./format.js";

export const TILE_STYLES = [
  { id: "flat", label: "Flat" },
  { id: "gradient", label: "Gradient" },
  { id: "aurora", label: "Aurora" },
  { id: "equalizer", label: "Equalizer" },
  { id: "riso", label: "Risograph" },
  { id: "hairline", label: "Hairline" },
];
const STYLE_IDS = new Set(TILE_STYLES.map((s) => s.id));
export const DEFAULT_TILE_STYLE = "flat";

// Bold system stack — matches the app's font-family, no webfont to wait on.
const FONT = (px) =>
  `700 ${px}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

// --- small deterministic helpers -----------------------------------------

// mulberry32 — a tiny seeded PRNG so the generative styles are stable per id.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h, s, l, a = 1) =>
  `hsl(${((h % 360) + 360) % 360} ${s}% ${l}% / ${a})`;

// Perceived luminance of an HSL colour (0..1) — picks black vs white text.
function hslLum(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return 0.2126 * f(0) + 0.7152 * f(8) + 0.0722 * f(4);
}
const textOn = (h, s, l) => (hslLum(h, s, l) > 0.55 ? "#141414" : "#ffffff");

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function centreText(ctx, text, S, px, fill) {
  ctx.fillStyle = fill;
  ctx.font = FONT(px);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, S / 2, S * 0.55);
}

// --- the six styles: draw(ctx, size, seed:uint32, mono:string) -----------

function flat(ctx, S, seed, mono) {
  const h = seed % 360;
  const s = 58;
  const l = 46;
  ctx.fillStyle = hsl(h, s, l);
  ctx.fillRect(0, 0, S, S);
  centreText(ctx, mono, S, S * 0.4, textOn(h, s, l));
}

function gradient(ctx, S, seed, mono) {
  const h1 = seed % 360;
  const h2 = (h1 + 45 + ((seed >>> 9) % 70)) % 360;
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, hsl(h1, 66, 54));
  g.addColorStop(1, hsl(h2, 60, 37));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const v = ctx.createRadialGradient(S / 2, S * 0.42, S * 0.1, S / 2, S / 2, S * 0.8);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.30)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
  ctx.shadowColor = "rgba(0,0,0,0.32)";
  ctx.shadowBlur = S * 0.05;
  ctx.shadowOffsetY = S * 0.012;
  centreText(ctx, mono, S, S * 0.4, "rgba(255,255,255,0.97)");
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function aurora(ctx, S, seed, mono) {
  const r = rng(seed);
  const h1 = seed % 360;
  ctx.fillStyle = hsl(h1, 30, 9);
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const hh = (h1 + i * 55 + r() * 50) % 360;
    const cx = (0.1 + r() * 0.8) * S;
    const cy = (0.1 + r() * 0.8) * S;
    const rad = S * (0.45 + r() * 0.45);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, hsl(hh, 78, 58, 0.55));
    g.addColorStop(1, hsl(hh, 78, 58, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.globalCompositeOperation = "source-over";
  centreText(ctx, mono, S, S * 0.5, "rgba(255,255,255,0.22)");
}

function equalizer(ctx, S, seed) {
  const r = rng(seed);
  const h1 = seed % 360;
  ctx.fillStyle = `hsl(${h1} 16% 9%)`;
  ctx.fillRect(0, 0, S, S);
  const n = 5 + Math.floor(r() * 3);
  const pad = S * 0.16;
  const gap = S * 0.05;
  const bw = (S - 2 * pad - (n - 1) * gap) / n;
  for (let i = 0; i < n; i++) {
    const hgt = S * (0.22 + r() * 0.62);
    const x = pad + i * (bw + gap);
    ctx.fillStyle = `hsl(146 62% ${46 + r() * 18}%)`;
    roundRect(ctx, x, S - pad - hgt, bw, hgt, Math.min(bw / 2, S * 0.028));
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, S - pad + 0.5);
  ctx.lineTo(S - pad, S - pad + 0.5);
  ctx.stroke();
}

function riso(ctx, S, seed, mono) {
  const r = rng(seed);
  const h1 = seed % 360;
  const h2 = (h1 + 150 + ((seed >>> 7) % 70)) % 360;
  ctx.fillStyle = `hsl(${h1} 40% 15%)`;
  ctx.fillRect(0, 0, S, S);
  const inkA = `hsl(${h2} 72% 58%)`;
  const inkB = `hsl(${(h2 + 28) % 360} 68% 50%)`;
  const shape = Math.floor(r() * 5);
  const path = () => {
    ctx.beginPath();
    if (shape === 0) ctx.arc(S * 0.74, S * 0.28, S * 0.4, 0, 7);
    else if (shape === 1) ctx.rect(-S * 0.1, S * 0.66, S * 1.2, S * 0.3);
    else if (shape === 2) ctx.arc(S * 0.16, S * 1.0, S * 0.58, Math.PI, 2 * Math.PI);
    else if (shape === 3) {
      ctx.moveTo(S * 0.32, S * 1.1);
      ctx.lineTo(S * 0.78, S * 0.18);
      ctx.lineTo(S * 1.2, S * 1.1);
      ctx.closePath();
    } else {
      ctx.arc(S * 0.68, S * 0.34, S * 0.34, 0, 7);
      ctx.arc(S * 0.68, S * 0.34, S * 0.18, 0, 7, true);
    }
  };
  ctx.save();
  ctx.translate(S * 0.035, S * 0.035);
  ctx.fillStyle = inkB;
  path();
  ctx.fill("evenodd");
  ctx.restore();
  ctx.fillStyle = inkA;
  path();
  ctx.fill("evenodd");

  ctx.globalAlpha = 0.05;
  const dots = Math.floor((S * S) / 11);
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = r() < 0.5 ? "#000" : "#fff";
    ctx.fillRect(r() * S, r() * S, 1, 1);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = FONT(S * 0.3);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = S * 0.06;
  ctx.fillText(mono, S * 0.11, S * 0.88);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

function hairline(ctx, S, seed, mono) {
  const h = seed % 360;
  ctx.fillStyle = "#141416";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  const m = S * 0.14;
  const t = S * 0.26;
  ctx.strokeStyle = `hsl(${h} 70% 60%)`;
  ctx.lineWidth = Math.max(2, S * 0.03);
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(m, m + t);
  ctx.lineTo(m, m);
  ctx.lineTo(m + t, m);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = FONT(S * 0.29);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(mono, S * 0.56, S * 0.61);
}

const DRAW = { flat, gradient, aurora, equalizer, riso, hairline };

// --- entry point --------------------------------------------------------

const cache = new Map(); // `${style}|${seed}|${mono}|${size}` -> data URL

/**
 * A data: URL (PNG) for the generated tile. `seedStr` fixes the colour and
 * shape — pass the stable context id so a rename doesn't recolour it —
 * `label` is what's drawn on it (the name the user sees). Cached: repeated
 * calls with the same arguments are free.
 */
export function tileDataUrl(styleId, seedStr, label, size = 52) {
  const style = STYLE_IDS.has(styleId) ? styleId : DEFAULT_TILE_STYLE;
  const mono = monogram(label);
  const key = `${style}|${seedStr}|${mono}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  DRAW[style](ctx, size, hashCode(seedStr), mono);
  const url = canvas.toDataURL("image/png");

  if (cache.size > 400) cache.clear(); // bounded in practice; hard cap anyway
  cache.set(key, url);
  return url;
}
