# relay/

Pages that a headless browser opens on `127.0.0.1` only. Each one draws or records a feed and sends
MediaRecorder chunks back over a WebSocket; the matching server module turns them into a stream.
None of these pages is served on the public site.

| Page | Opened by | What it does |
|---|---|---|
| `relay.html` | `server/relay.mjs` | Joins the avatar provider's TRTC room with the viewer ticket from `/config`, records her picture and voice, and the server turns it into HLS for the web room. Loads `vendor/trtc.js`. |
| `square.html` | `server/square.mjs` | The 16:9 Binance Square live feed: her live picture in the middle, market panels, captions, gift thanks, songs and the optional big-move clips around it. |
| `radio.html` | `server/radio.mjs` | The voice-only radio between shows: her still picture (or an optional data board) and her spoken answers to chat, with songs underneath. |

## What the pages read from `/config`

- `square.html`: `width`, `height`, `fps`, `kbps`, `still`, `clips`, plus the viewer ticket. Optional:
  `name` (her name on screen), `tagline`, `tz` (hours from UTC for the on-screen clock, default 8),
  `tzLabel`.
- `radio.html`: `width`, `height`, `fps`, `kbps`, `name`, `title`, `board` (true when the host config
  sets `radio.boardUrl`), `still`.

The optional radio board is fetched from `/board` every 3 s and drawn when it has this shape
(every field optional):

```json
{ "title": "Live board", "big": 1234, "bigLabel": "today", "rows": [{ "name": "alpha", "value": 42, "note": "new" }] }
```

## Optional media (none shipped)

Everything below is optional. A missing file is skipped quietly: a missing sound is silent, a missing
clip is never offered.

- `clips/<name>.mp4`: her big-move clips. Only names listed in the host config's `idol.bigMoves.clips`
  are played, and only when the file exists. Lowercase letters only in the name.
- `sfx/<name>.mp3`: short stings over the feed: `whoosh`, `cheer`, `gasp`, `boom`.

## Fonts

`fonts/kai.ttf` and `fonts/num.ttf` are served at `/font/kai.ttf` and `/font/num.ttf`. Both are
SIL Open Font License 1.1 fonts; see `fonts/README.md`.

## Third-party script

`vendor/trtc.js` is Tencent's TRTC Web SDK (v3.49.0), shipped as downloaded. Its license is not
stated in the file; check Tencent Cloud's terms before you redistribute it, or fetch your own copy
from Tencent and drop it here. `square.html` also loads `/vendor/volc-rtc.min.js` (Volcengine RTC
Web SDK); the server serves it from `public/vendor/`, next to its `volc-rtc.LICENSE`.
