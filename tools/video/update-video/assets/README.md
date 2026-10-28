# assets / 素材目录

Nothing here is shipped: put your own files in these folders (or point `--assets` / `"assets_dir"` somewhere else).
Paths in the storyboard are relative to this folder. 这里不附带任何文件，自己放进来；storyboard 里的路径相对这个目录。

| folder | what goes in | example name in `storyboard.example.json` |
|---|---|---|
| `clips/` | pieces of the live replay (any size; vertical clips get a blurred fill) 回放片段 | `before.mp4`, `after.mp4` |
| `images/` | screenshots, the host's avatar 截图、头像 | `screenshot.png`, `avatar.png` |
| `music/` | background music, one track per section 配乐 (mp3/wav/m4a) | `intro.mp3`, `sad.mp3`, `upbeat.mp3`, `bright.mp3` |
| `sfx/` | short sound effects 音效 (wav/mp3/ogg) | `click.wav`, `confirm.wav`, `error.wav`, `boom.wav`, `whoosh.wav` |
| `voice/` | voice-over lines, e.g. from your TTS 配音 | `line1.wav` |

Free sound effects: Kenney's audio packs (kenney.nl, CC0) or freesound.org (check each file's license).
Music: use tracks you have the rights to. A missing music or sfx file is skipped with a warning, so you can render
before you have picked any. 缺配乐或音效只会警告并跳过，可以先出片看画面。
