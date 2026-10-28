// Tiny audio helpers: mono 16-bit WAV read/write in plain JS; anything else goes through ffmpeg.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

export function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, fmt = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4), body = off + 8;
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14), tag: b.readUInt16LE(body) };
    if (id === 'data' && fmt) {
      if (fmt.tag !== 1 || fmt.bits !== 16) return null;
      const n = Math.floor(Math.min(size, b.length - body) / 2 / fmt.ch), x = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += b.readInt16LE(body + (i * fmt.ch + c) * 2); x[i] = s / fmt.ch / 32768; }
      return { x, sr: fmt.sr };
    }
    off = body + size + (size & 1);
  }
  return null;
}

// Load any audio as mono float at `sr` (resampled by ffmpeg when needed; WAV at the right rate needs no ffmpeg).
export function load(file, sr = 16000) {
  if (/\.wav$/i.test(file)) { const w = readWav(file); if (w && w.sr === sr) return w.x; }
  if (/\.pcm$/i.test(file)) { const b = fs.readFileSync(file), x = new Float32Array(b.length >> 1); for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(i * 2) / 32768; return x; }
  const raw = execFileSync('ffmpeg', ['-v', 'quiet', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  const x = new Float32Array(raw.length >> 1);
  for (let i = 0; i < x.length; i++) x[i] = raw.readInt16LE(i * 2) / 32768;
  return x;
}

export function writeWav(file, x, sr) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  fs.writeFileSync(file, b);
}

export const pcmToFloat = buf => { const x = new Float32Array(buf.length >> 1); for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768; return x; };
export const rms = (x, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
export const db = v => 20 * Math.log10(v + 1e-9);
export const percentile = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const k = (s.length - 1) * p / 100, f = Math.floor(k); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f); };
export function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0), out = new Float32Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
