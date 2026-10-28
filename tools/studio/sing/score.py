#!/usr/bin/env python3
"""Score singing candidates without listening to all of them:
  pitch  = share of voiced 10 ms frames within 0.8 semitone of the original vocal (also octave-agnostic)
  like   = speaker similarity to the target voice (CAMPPlus embedding cosine; same person speaking twice is ~0.85-0.9)
  src    = similarity to the ORIGINAL singer (should drop after conversion)
Needs the Seed-VC venv (librosa, torch, torchaudio) and its campplus_cn_common.bin (downloaded on first Seed-VC run).

Usage: $SEEDVC_DIR/.venv/bin/python sing/score.py <original_vocals.wav> <target_voice.wav> <candidate.wav> [...]
"""
import os, sys
import numpy as np

def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    import librosa, torch, torchaudio
    seedvc = os.environ.get('SEEDVC_DIR', os.path.expanduser('~/seed-vc'))
    sys.path.insert(0, seedvc)
    from modules.campplus.DTDNN import CAMPPlus
    ck = os.path.join(seedvc, 'campplus_cn_common.bin')
    if not os.path.exists(ck):
        from huggingface_hub import hf_hub_download
        ck = hf_hub_download('funasr/campplus', 'campplus_cn_common.bin')
    cp = CAMPPlus(feat_dim=80, embedding_size=192); cp.load_state_dict(torch.load(ck, map_location='cpu')); cp.eval()

    def emb(p):
        y, _ = librosa.load(p, sr=16000, mono=True)
        f = torchaudio.compliance.kaldi.fbank(torch.tensor(y)[None] * 32768, num_mel_bins=80, dither=0, sample_frequency=16000)
        f = f - f.mean(0, keepdim=True)
        with torch.no_grad():
            e = cp(f[None])[0].numpy()
        return e / np.linalg.norm(e)

    def f0(p):
        y, sr = librosa.load(p, sr=22050, mono=True)
        f, v, _ = librosa.pyin(y, fmin=80, fmax=1000, sr=sr, frame_length=1024, hop_length=220)
        return np.where(v, 69 + 12 * np.log2(np.maximum(np.nan_to_num(f, nan=1), 1) / 440), np.nan)

    src, ref = sys.argv[1], sys.argv[2]
    T, E_ref, E_src = f0(src), emb(ref), emb(src)
    print(f'baseline: original singer vs target voice similarity {float(E_src @ E_ref):.3f}')
    print(f'{"candidate":28s} pitch  pitch(any octave)  voiced  like  src')
    for c in sys.argv[3:]:
        V = f0(c); n = min(len(T), len(V)); m = ~np.isnan(T[:n]) & ~np.isnan(V[:n])
        d = V[:n][m] - T[:n][m]
        any_oct = (np.abs((d + 6) % 12 - 6) < 0.8).mean() if m.any() else 0
        e = emb(c)
        print(f'{os.path.basename(c)[:28]:28s} {(np.abs(d) < 0.8).mean() if m.any() else 0:.3f}  {any_oct:.3f}              {m.mean():.3f}   {float(e @ E_ref):.3f} {float(e @ E_src):.3f}', flush=True)

if __name__ == '__main__':
    main()
