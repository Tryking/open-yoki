# ops: posting on Binance Square, radio talking points

The Node server (`app/`) is the host: it talks, makes the stream and decides what to post. `square_post.py` takes the
posts she queued and sends them to Square through Square's official OpenAPI; `facts.py` hands the between-shows radio
Binance's latest activity announcements (public pages, no login), so she never makes up a reward.

| Unit | What it does |
| --- | --- |
| `livehost.service` | the Node server (`/opt/livehost/app`, user `livehost`, settings `/etc/livehost/livehost.env`) |
| `livehost-post.timer` (2 min) | `square_post.py`: posts what the host queued (`GET /api/square/outbox`) through the OpenAPI and reports back (`POST /api/square/outbox/done`). Needs `SQUARE_OPENAPI_KEY` (made in the Square creator center); without it nothing is posted on Square. X is posted by the server itself through the official X API |
| `livehost-facts.timer` (2 h) | `facts.py`: Binance's public activity announcements to the server (`POST /api/square/facts`), the radio's only source for activity questions |

Chat, viewers and gifts come in through the server's ingest API, from whatever reads your platform's room. See
"Feeding chat in" in the main README.

The radio between shows (server/radio.mjs, `relay/radio.html`) pushes a voice-only stream to the RTMP address the
server holds. Opening and closing that live on Square is yours to do (by hand, or your own tool), then tell the server
with `POST /api/square/radio`. `bash ops/radio-check.sh [minutes]` prints how the radio has been doing.

## Settings

`conf.py` reads `/etc/livehost/square.env`, then the environment: `SERVER_URL` (default `http://127.0.0.1:4370`),
`INGEST_KEY_FILE` (default `/var/lib/livehost/data/square-ingest.key`, written by the server on first start and sent
as `x-square-key`), `SQUARE_OPENAPI_KEY` and `SQUARE_LANG` (the announcement list's language, default `zh-CN`).

## Python

Python 3.9+, standard library only. `deploy/install.sh` makes a venv at `ops/venv` for it.

```
python3 ops/square_post.py check    # is the OpenAPI key there
python3 ops/square_post.py          # one run
python3 ops/facts.py                # fetch the announcements once
```
