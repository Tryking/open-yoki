# Setup tools

One-time setup for an idol's Vidu avatar and Doubao voice. Run them from `app/`. Keys come from the environment
only; `--idol` picks `idols/<id>/` and defaults to `example`.

| Tool | What it does | Env |
| --- | --- | --- |
| `vidu-looks.mjs` | Uploads each stage look (and an optional `off` look) as a Vidu avatar asset and writes the ids to `idols/<id>/vidu-looks.json`. Pictures come from `public/art/<id>/looks/<stage key>.png\|jpg` or `--src`. Free; assets expire after 90 days, so re-run with `--force` before `expires`. | `VIDU_KEY`, optional `VIDU_BASE` |
| `vidu-upload-one.mjs` | Uploads one picture under any key (`--file`, `--key`) into the same `vidu-looks.json`. | `VIDU_KEY`, optional `VIDU_BASE` |
| `vidu-actions.mjs` | Syncs the config's `actions[*].lib` descriptions into a Vidu action library and prints `VIDU_ACTION_LIB=<id>` to bind. Free. | `VIDU_KEY`, optional `VIDU_BASE` |
| `volc-clone.mjs` | Clones a voice with Doubao voice cloning 2.0 into a slot you bought in the Volcengine console; the slot id is then your `DOUBAO_VOICE_ID`. Can save Doubao's demo audio. | `VOLC_API_KEY` |
| `voice-tones-sample.mjs` | Says one line in the plain voice and in every tone of `idol.avatar.doubao.tones`, and joins them into `all.mp3` so you can tune each tone. Needs ffmpeg. | `VOLC_API_KEY`, `DOUBAO_VOICE_ID` (or the config's `voiceId`) |

`vidu.mjs` holds the shared Vidu API helper. Converting PNGs to JPEG uses `sips` on macOS and `ffmpeg` elsewhere.

Order for a new host: clone the voice, sample its tones, upload the looks, sync the action library, then put the ids
in the config or the env (`DOUBAO_VOICE_ID`, `VIDU_ACTION_LIB`, `VIDU_AVATAR_ID` as the fallback avatar).
