#!/usr/bin/env python3
"""Mix a converted vocal back over the backing track: level-match, light EQ, de-ess, short room reverb,
loudness to -14 LUFS (true peak <= -1). Needs only ffmpeg.

Usage:
  python3 sing/mix.py --vocal converted.wav --inst no_vocals.wav --out song.mp3
        [--start 0] [--end <inst length>] [--vocal-offset <start>] [--gain 0] [--match original_vocals.wav]
        [--reverb 0.18] [--lufs -14]
  --start/--end    range on the backing-track timeline to keep
  --vocal-offset   where the vocal file begins on that timeline (default = --start)
  --match          original vocal stem: the converted vocal is set to the same loudness over the range
"""
import argparse, os, subprocess, sys

def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode: sys.exit('ffmpeg failed: ' + r.stderr[-400:])
    return r.stderr

def duration(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())

def mean_db(f, ss, t):
    s = run(['ffmpeg', '-hide_banner', '-ss', str(ss), '-t', str(t), '-i', f, '-af', 'volumedetect', '-f', 'null', '-'])
    return float([l for l in s.splitlines() if 'mean_volume' in l][0].split()[-2])

def lufs(f):
    s = run(['ffmpeg', '-hide_banner', '-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'])
    return float([l for l in s.splitlines() if l.strip().startswith('I:')][-1].split()[1])

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--vocal', required=True); p.add_argument('--inst', required=True); p.add_argument('--out', required=True)
    p.add_argument('--start', type=float, default=0.0); p.add_argument('--end', type=float)
    p.add_argument('--vocal-offset', type=float); p.add_argument('--gain', type=float, default=0.0)
    p.add_argument('--match'); p.add_argument('--reverb', type=float, default=0.18); p.add_argument('--lufs', type=float, default=-14.0)
    a = p.parse_args()
    end = a.end if a.end is not None else duration(a.inst)
    off = a.start if a.vocal_offset is None else a.vocal_offset
    d = end - a.start
    if d <= 0.5: sys.exit('range too short')
    match = 0.0
    if a.match:  # converted vocal at the same level as the original vocal over the range
        match = mean_db(a.match, a.start, d) - mean_db(a.vocal, a.start - off, d)
    vs = max(0.0, a.start - off)
    rv = f',aecho=0.8:0.5:60|120:{a.reverb:.2f}|{a.reverb * 0.55:.2f}' if a.reverb > 0 else ''
    fc = (f'[0:a]atrim={vs}:{vs + d},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,'
          f'highpass=f=90,equalizer=f=250:t=q:w=1:g=-2,equalizer=f=4500:t=q:w=1.2:g=2.5,deesser=i=0.3,volume={a.gain + match:.2f}dB{rv},'
          f'afade=t=in:d=0.12,afade=t=out:st={max(0, d - 0.6):.3f}:d=0.6[v];'
          f'[1:a]atrim={a.start}:{end},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,afade=t=in:d=0.25,afade=t=out:st={max(0, d - 0.9):.3f}:d=0.9[i];'
          f'[v][i]amix=inputs=2:normalize=0[o]')
    tmp = a.out + '.tmp.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-i', a.vocal, '-i', a.inst, '-filter_complex', fc, '-map', '[o]', '-ar', '44100', tmp])
    gain = a.lufs - lufs(tmp); I = None
    for _ in range(4):  # the limiter eats a little loudness: measure and correct until within 0.3 LU
        run(['ffmpeg', '-v', 'error', '-y', '-i', tmp, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.89:level=disabled', '-ar', '44100', '-b:a', '256k', a.out])
        I = lufs(a.out)
        if abs(I - a.lufs) <= 0.3: break
        gain += a.lufs - I
    os.remove(tmp)
    print(f'✓ {a.out}  {I:.1f} LUFS  {d:.2f} s  (vocal level {a.gain + match:+.1f} dB)')

if __name__ == '__main__':
    main()
