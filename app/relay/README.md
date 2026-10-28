# relay/

这些页面只给无头浏览器在 `127.0.0.1` 上打开。每个页面负责画出或录下一路画面，把 MediaRecorder 录出的分段通过 WebSocket 送回去；对应的服务器模块再把它们变成直播流。
这些页面都不放在公开网站上。

| 页面 | 谁打开它 | 做什么 |
|---|---|---|
| `relay.html` | `server/relay.mjs` | 用 `/config` 给的观众票据进形象服务商的 TRTC 房间，录下她的画面和声音，服务器把它转成 HLS 给网页直播间用。会加载 `vendor/trtc.js`。 |
| `square.html` | `server/square.mjs` | 币安广场的 16:9 直播画面：中间是她的实时画面，四周是行情面板、字幕、对礼物的感谢、歌，以及可选的大动作短片。 |
| `radio.html` | `server/radio.mjs` | 两场直播之间只有声音的电台：她的静图（或者一块可选的数据看板），她开口回弹幕，底下放着歌。 |

## 页面从 `/config` 读什么

- `square.html`：`width`、`height`、`fps`、`kbps`、`still`、`clips`，以及观众票据。可选：
  `name`（画面上显示的她的名字）、`tagline`、`tz`（画面上时钟比 UTC 快几小时，默认 8）、
  `tzLabel`。
- `radio.html`：`width`、`height`、`fps`、`kbps`、`name`、`title`、`board`（主播配置里设了
  `radio.boardUrl` 时为 true）、`still`。

可选的电台看板每 3 秒从 `/board` 取一次，内容是下面这个样子时就画出来
（每个字段都可以不填）：

```json
{ "title": "Live board", "big": 1234, "bigLabel": "today", "rows": [{ "name": "alpha", "value": 42, "note": "new" }] }
```

## 可选的素材（都不附带）

下面这些都是可选的。缺了的文件会悄悄跳过：缺音效就没声音，缺短片就不会放。

- `clips/<name>.mp4`：她的大动作短片。只放主播配置里 `idol.bigMoves.clips` 列出的名字，
  而且文件得真的存在。名字只能用小写字母。
- `sfx/<name>.mp3`：叠在画面上的短音效：`whoosh`、`cheer`、`gasp`、`boom`。

## 字体

`fonts/kai.ttf` 和 `fonts/num.ttf` 分别在 `/font/kai.ttf` 和 `/font/num.ttf` 提供。两个都是
SIL Open Font License 1.1 授权的字体，见 `fonts/README.md`。

## 第三方脚本

`vendor/trtc.js` 是腾讯的 TRTC Web SDK（v3.49.0），按下载下来的原样附带。文件里没写它的许可；
再分发之前先看腾讯云的条款，或者自己从腾讯那里下一份放到这里。`square.html` 还会加载
`/vendor/volc-rtc.min.js`（火山引擎 RTC Web SDK）；服务器从 `public/vendor/` 提供它，旁边放着它的 `volc-rtc.LICENSE`。
