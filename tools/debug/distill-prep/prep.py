#!/usr/bin/env python3
# Distill prep: turn a stretch of a real streamer's video into material you can study for one evening:
# a low-res clip, numbered frame grids (one frame every N seconds), the audio, an optional transcript, and a notes
# template with the tables the distilling method fills in (speech habits, body language, mapping to your avatar's
# action library, suggestions, proposed changes). Needs ffmpeg; standard library only.
#
#   python3 prep.py VIDEO --code c1 --start 00:20:00 --dur 150 --every 2 --out study/ [--asr "<command using $AUDIO>"]
#   (run it once per clip; every clip gets its own code c1, c2 ... and they all land in the same notes.md)
# Keep the material local and out of your repo: it is someone else's video.
import os, subprocess, sys

def arg(k, d=None):
    a = sys.argv
    return a[a.index(k) + 1] if k in a and a.index(k) + 1 < len(a) else d

def run(*cmd): subprocess.run(list(cmd), check=True)

TEMPLATE = """# Distill notes: {who}

Material stays local. Only write down what you saw or heard yourself, with the clip code and frame number.
Things you cannot find a source for (rumours, "everyone knows she always ...") do not go into the character.

## 1. Material

| code | source (url / part / start) | what happens | frames looked at |
|---|---|---|---|
{rows}

## 2. Speech: what she actually does
(one finding per item, each with a quoted example and its clip code)

1.

## 3. Body: the most typical expressions / gestures
(go through the frame grids; note what she was doing at that moment)

| # | expression / gesture | when (clip, frame) | used for |
|---|---|---|---|
| B1 | | | |

## 4. Mapped to our avatar's action library
(already have it -> reuse it and say when; missing -> describe one new action precisely: hands, eyes, head,
how long, how it ends; mark it trial and check it on a recording before it goes live)

| # | hers | ours today | when to use / what to make |
|---|---|---|---|

## 5. Suggestions for the character (observations only; the character picks what fits)

-

## 6. Possible code / prompt changes (proposals; mark the ones the owner has to decide)

1.
"""

def main():
    if len(sys.argv) < 2 or sys.argv[1].startswith('--'):
        print('usage: prep.py VIDEO --code c1 --start 00:00:00 --dur 150 --every 2 --out study/ [--asr "..."] [--who name]'); sys.exit(2)
    video, code = sys.argv[1], arg('--code', 'c1')
    start, dur, every, out = arg('--start', '0'), arg('--dur', '150'), float(arg('--every', 2)), arg('--out', 'study')
    d = os.path.join(out, code); os.makedirs(os.path.join(d, 'frames'), exist_ok=True)
    clip, wav = os.path.join(d, 'clip.mp4'), os.path.join(d, 'audio.wav')
    run('ffmpeg', '-v', 'error', '-nostdin', '-y', '-ss', start, '-t', dur, '-i', video, '-vf', 'scale=-2:360', '-c:v', 'libx264', '-crf', '30', '-c:a', 'aac', '-b:a', '64k', clip)
    run('ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', clip, '-vn', '-ac', '1', '-ar', '16000', wav)
    run('ffmpeg', '-v', 'error', '-nostdin', '-y', '-i', clip, '-vf', f'fps=1/{every},scale=320:-2', os.path.join(d, 'frames', '%04d.png'))
    frames = sorted(os.listdir(os.path.join(d, 'frames')))
    # grids of 6x6, numbered in reading order; frames.txt maps frame number -> second in the clip
    for g in range(0, len(frames), 36):
        run('ffmpeg', '-v', 'error', '-nostdin', '-y', '-start_number', str(g + 1), '-i', os.path.join(d, 'frames', '%04d.png'),
            '-vf', 'tile=6x6:padding=4:margin=4', '-frames:v', '1', os.path.join(d, f'grid-{g // 36 + 1}.png'))
    with open(os.path.join(d, 'frames.txt'), 'w') as fh:
        fh.write('\n'.join(f'frame {i + 1}: {i * every:.0f}s (grid {i // 36 + 1}, row {(i % 36) // 6 + 1}, col {i % 6 + 1})' for i in range(len(frames))) + '\n')
    if arg('--asr'):
        text = subprocess.run(arg('--asr'), shell=True, capture_output=True, text=True, env={**os.environ, 'AUDIO': wav}).stdout
        open(os.path.join(d, 'transcript.txt'), 'w').write(text)
    notes = os.path.join(out, 'notes.md')
    row = f'| {code} | {os.path.basename(video)} from {start}, {dur} s | | {len(frames)} |'
    if not os.path.exists(notes):
        open(notes, 'w').write(TEMPLATE.format(who=arg('--who', 'streamer'), rows=row))
    else:
        s = open(notes).read()
        if f'| {code} |' not in s:
            s = s.replace('\n\n## 2.', f'\n{row}\n\n## 2.', 1); open(notes, 'w').write(s)
    print(f'{code}: {len(frames)} frames in {(len(frames) + 35) // 36} grids, notes in {notes}')

if __name__ == '__main__':
    main()
