#!/usr/bin/env python3
"""Match EQ: pull the long-term spectrum of <input> toward <target> (1/3-octave smoothed), capped per band.
Useful when the converted voice sounds thin or nasal next to the speaking reference. Needs librosa + soundfile.

Usage: python sing/matcheq.py <input.wav> <target.wav> <out.wav> [strength=1.0] [max_db=15]
"""
import sys
import numpy as np

def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    import librosa, soundfile as sf
    src, tgt, out = sys.argv[1:4]
    k = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
    mx = float(sys.argv[5]) if len(sys.argv) > 5 else 15.0
    SR, N = 44100, 4096

    def ltas(y):
        S = np.abs(librosa.stft(y, n_fft=N)) ** 2
        e = np.sqrt(np.sum(S, 0)); act = e > np.percentile(e, 40)  # voiced frames only
        return 10 * np.log10(S[:, act].mean(1) + 1e-12)

    x, _ = librosa.load(src, sr=SR, mono=False); x = np.atleast_2d(x)
    t, _ = librosa.load(tgt, sr=SR)
    fr = librosa.fft_frequencies(sr=SR, n_fft=N)
    d = ltas(t) - ltas(x.mean(0))
    sm = np.zeros_like(d)
    for i, f in enumerate(fr):
        m = (fr >= f / 2 ** (1 / 6)) & (fr <= f * 2 ** (1 / 6))
        sm[i] = d[m].mean() if m.any() else d[i]
    ref = sm[(fr > 300) & (fr < 1500)].mean()
    g = np.clip((sm - ref) * k, -mx, mx); g[fr < 80] = min(g[fr < 80].min(), 0)
    G = 10 ** (g / 20)
    y = np.stack([librosa.istft(librosa.stft(c, n_fft=N) * G[:, None], n_fft=N, length=len(c)) for c in x])
    peak = np.abs(y).max(); y = y / peak * 0.9 if peak > 0.9 else y
    sf.write(out, y.T, SR)
    bands = [(150, 800), (800, 3000), (3000, 6000), (6000, 12000)]
    print(out, ' '.join('%d-%d:%+.1f dB' % (a, b, g[(fr >= a) & (fr < b)].mean()) for a, b in bands))

if __name__ == '__main__':
    main()
