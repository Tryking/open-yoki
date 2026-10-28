# voice-audition：声音情绪试听 / emotional voice audition

情绪不能只靠给配音接口一个“生气”的标签。做法：台词写成真人脱口而出的样子（打断、重复、半句、语气词），一句拆几段各给语气和快慢，合成后自己调每段音量、接停顿，再量起伏、找人盲听。

```sh
node render.mjs --lines lines.example.json --voices voices.example.json --voice mock --out work   # mock 不联网
node stitch.mjs --work work --lines lines.example.json --voice mock
node measure.mjs work/angry-1 real-person.wav           # 音高起伏 / 响度起伏 / 快慢比，和真人录音比
node reel.mjs --out listen.wav work/angry-1/mock-whole-level.wav work/angry-1/mock-stitched.wav
node ear.mjs --work work --lines lines.example.json --model ear.json      # 让能听音频的模型盲标情绪（花钱）
node words.mjs --work work --lines lines.example.json --asr '<转写命令，用 $AUDIO>'  # 喊破音后字还在不在
node selftest.mjs
```

`voices.json` 里配音引擎：`doubao`（火山引擎豆包 TTS v3，钥匙和音色 ID 都从环境变量读，别把你的复刻音色 ID 写进仓库）、`command`（任何能在命令行调的 TTS）、`mock`。

English: write lines the way people blurt them, render them in chunks with their own style and speed, stitch with planned gains and pauses, then measure pitch/loudness/tempo swings against a real recording and have a model label emotions blind.
