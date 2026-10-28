"""Small ffmpeg / ffprobe helpers shared by the video tools."""
import json, shutil, subprocess

def need(*tools):
    for t in tools:
        if not shutil.which(t):
            raise SystemExit(f'{t} not found on PATH. Install ffmpeg (macOS: `brew install ffmpeg`, Debian/Ubuntu: `apt install ffmpeg`).')

def ff(*args):
    """run ffmpeg quietly, raise on failure"""
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-nostdin', *map(str, args)], check=True)

def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
                          '-of', 'json', str(path)], check=True, capture_output=True, text=True).stdout
    return json.loads(out)

def duration(path):
    return float(probe(path)['format']['duration'])

def video_size(path):
    for s in probe(path).get('streams', []):
        if s.get('codec_type') == 'video': return int(s['width']), int(s['height'])
    raise ValueError(f'no video stream in {path}')

def has_audio(path):
    return any(s.get('codec_type') == 'audio' for s in probe(path).get('streams', []))
