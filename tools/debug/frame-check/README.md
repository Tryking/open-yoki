# frame-check：画面卡顿和对脸 / stutter and face check

```sh
python3 framecheck.py fps  recording.mp4 --window 20 --min-fps 20      # 每 20 秒真动了几帧、重复帧比例、最长卡住
python3 framecheck.py sheet recording.mp4 --every 2 --ref face.png --crop 400:400:760:120 --out sheet.png   # 脸和定妆照并排
python3 selftest.py
```

`fps` 用在你推给平台的那路录像上：真动的帧数掉到 20 以下的窗口就是观众看到卡的地方。`sheet` 把每隔几秒的一帧（可以只裁脸）和定妆照并排拼成一张图，用眼睛一格格看，比自动“相似度分数”可靠。

English: `fps` finds windows where the picture really moved fewer than N frames a second; `sheet` builds a contact sheet with your reference face beside every frame for an eye check.
