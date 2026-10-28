# open-yoki 搭建说明（写给帮主播搭建的 AI）

这个包让一个 AI 主播在**币安广场**和她自己的网页直播间按时间表自己直播：读弹幕、用本人的声音和数字人形象回答、记住常来的人、写日记、自己发动态。
主播本人只做三件事：**回答人设问题**（你帮着写进 `profile.mjs`）、**给一张形象图和一段录音**、**每场开播前在币安广场的直播后台开好直播间，把推流地址交给你**。其余都由你（AI）照这份说明完成。

一台服务器跑全部东西。照顺序做，每一步做完都有“确认”，确认过了再往下走。

**路径约定**

- `<包>`：你电脑上这个包的文件夹（有 `app/`、`ops/`、`deploy/` 的那一层）。命令里写的是相对它的路径，先 `cd` 进去。
- `<id>`：主播文件夹名，英文小写，比如 `lili`。
- 服务器上：程序在 `/opt/livehost/app`，广场发帖脚本在 `/opt/livehost/ops`，设置在 `/etc/livehost/livehost.env` 和 `/etc/livehost/square.env`，数据在 `/var/lib/livehost/`，端口 4370。

**钥匙的规矩**：钥匙只写进服务器上的 `/etc/livehost/*.env`（root、600 权限）和 Telegram 的 `bot.json`；不写进主播配置、代码、聊天记录，不打印到屏幕上。在自己电脑上临时要用时，用 `read -s` 输进当前终端，关掉终端就没了。

---

## 0. 先跟主播确认这几件事

| 要什么 | 谁出 | 说明 |
|---|---|---|
| 一张形象图 | 主播 | 一个人的正面半身照，脸清楚，画面里没有字。竖图（9:16）最好。生成的或本人照片都行。 |
| 一段录音 | 主播 | 10–30 秒、只有本人说话、没有背景音乐和回声，正常聊天的语气。 |
| 人设 | 主播回答，你来写 | 她是谁、怎么说话、在意什么、什么不说。见第 2 步。**别替真人编经历**，没想好的地方问主播。 |
| 币安账号 | 主播 | 先在币安广场开通**直播权限**（币安 App → 广场 → 个人主页 → 直播，按提示申请）。服务器不登录这个账号：每场直播由主播自己在广场开，推流地址交给服务器。 |
| 一台服务器 | 主播付钱，你来开 | 见第 1 步。 |
| 第 3 步的账号 | 主播注册和付钱，你来填 | 至少要 OpenRouter、火山引擎（豆包语音 + RTC）、Vidu。其他可选。 |

确认：上面每一行都有着落；主播知道每场开播前要自己在广场开直播间、交推流地址（第 9、12 步），弹幕要用你们自己的办法接进来（第 8 步）。

## 1. 服务器

- **地区：香港、新加坡或日本**。不要放中国大陆（币安、OpenRouter、X 都连不上）。
- **必须是 x86_64（amd64）**：画直播画面用的 Chrome 没有 ARM 版。`install.sh` 一开始会检查，不对就停。
- 系统 Ubuntu 22.04 或 24.04；建议 4 核 8 GB（要同时跑无头 Chrome、ffmpeg 推流和 Node），硬盘 40 GB 以上。
- 只用钥匙登录 SSH，关掉密码登录。对外只开 SSH；要开网页直播间（第 10 步）时再开 80/443。

确认：`ssh root@<服务器IP>` 能登上；`dpkg --print-architecture` 显示 `amd64`；`lsb_release -rs` 是 22.04 或 24.04。

## 2. 在你电脑上准备包、建主播文件夹

你电脑上要有 Node.js 22 以上和 ffmpeg。

```bash
cd <包>/app && npm ci && npm test
```

全部通过再往下走。然后建主播文件夹：

```bash
cd <包>/app && cp -r idols/example idols/<id>
```

- `idols/<id>/config.mjs`：把 `id: 'example'` 改成 `id: '<id>'`；把开头 `PLACES` 里的广场名字和主页链接里的 handle、X 账号（不带 @）、网站域名、Telegram 群名和邀请链接（只在网页上显示）、直播时间的说法填上，没有的留空。按需要改 `schedule`（每天几点到几点播）、`tz`/`tzName`（时区）。
- `idols/<id>/profile.mjs`：她是谁。每一项上面都有说明，样板“小例”是编的，**每一项都换成主播本人的回答**。最有用的是 `voiceLines`：录一段主播随便聊几分钟的话，原样抄几句进来。
- 形象图放到 `public/art/<id>/looks/s1.jpg`（jpg，竖图）。`config.mjs` 里 `avatar.image` 改成 `/art/<id>/looks/s1.jpg`。
- 录音先放在你电脑上任意位置，第 4 步用，**不要放进包里**。

确认：

```bash
cd <包>/app && IDOL=<id> AVATAR=mock MODE=test PORT=4380 node server/index.mjs
```

日志里出现 `livehost (<id>, test) on http://127.0.0.1:4380`，浏览器打开 `http://127.0.0.1:4380` 能看到她的形象图和名字（中文、英文都切一下）。这时 `model=false voice=false` 是正常的，还没有钥匙。按 Ctrl+C 停掉。

## 3. 开账号、拿钥匙

钥匙先让主播存在自己的密码管理器里，第 4 步临时用，第 6 步写进服务器。

| 设置名 | 做什么 | 去哪拿 | 大概花多少 |
|---|---|---|---|
| `OPENROUTER_API_KEY` | 嘴（读弹幕、想怎么回） | [openrouter.ai/keys](https://openrouter.ai/keys)，充值 10 美元起 | 默认 DeepSeek，一场几毛钱 |
| `VOLC_API_KEY` | 声音（豆包语音合成 + 声音复刻） | [火山引擎控制台](https://console.volcengine.com) → 豆包语音 → API Key 管理；再到“声音复刻”**买一个音色槽位**（编号 `S_` 开头，第 4 步用） | 合成约 3 元/万字；槽位按控制台标价 |
| `VOLC_RTC_APP_ID` / `VOLC_RTC_APP_KEY` | 把数字人画面送到直播推流和网页直播间。**没有它就没有广场画面** | 同一个火山账号 → 实时音视频 RTC → 应用管理 → 创建应用，复制 AppID 和 AppKey | 按分钟，一场几块钱 |
| `VIDU_KEY` | 数字人画面（实时口型、表情、动作） | [platform.vidu.cn](https://platform.vidu.cn) 注册 → 开通实时数字人 → API Keys，先充值积分 | 按连线时长计费，是最大的一笔，以控制台标价为准。只在开播且有人看时连线 |
| `HEART_KEY_DS` | 可选但推荐：DeepSeek，心的便宜模型；Telegram 运营群秒回也用它 | [platform.deepseek.com](https://platform.deepseek.com) → API keys | 很便宜 |
| `HEART_KEY` | 可选：心用 Claude（更细腻） | [console.anthropic.com](https://console.anthropic.com)。**Anthropic 不对香港和中国大陆开放**：服务器在香港时要一个兼容的中转，填 `HEART_BASE_URL` 和中转给的钥匙；有备用中转就填 `HEART_KEY_RELAY` + `HEART_RELAY_URL` | 一天几美元 |
| `SQUARE_OPENAPI_KEY` | 可选：她写的动态通过币安官方接口发到广场；不填就不发广场 | [币安广场创作者中心](https://www.binance.com/square/creator-center/home)，用主播账号申请 | 免费 |
| `X_API_KEY` `X_API_SECRET` `X_ACCESS_TOKEN` `X_ACCESS_SECRET` `X_BEARER_TOKEN` | 可选：她自己发推；Bearer 只用来读推找话题 | [developer.x.com](https://developer.x.com) → 建 Project 和 App → User authentication settings 设成 **Read and write** → Keys and tokens 生成这 5 个（**先改权限再生成 Access Token**，否则发不了推） | 按用量付费，先在开发者后台充值 |
| Telegram 机器人 | 可选：粉丝群和运营群 | Telegram 里找 @BotFather → `/newbot`，拿到 token；把机器人拉进粉丝群和运营群并设为管理员 | 免费 |
| `TIKHUB_KEY`、`COINANK_API_KEY` | 可选：心刷抖音热门、聊合约行情时用的数据 | 见 `.env.example` 里每行的说明 | 按各家标价 |
| `TOWN_KEY`、`TOWN_ALLOW` | 可选：接外部 AI 世界（比如 TwinOasis） | `TOWN_KEY` 你自己定一串够长的随机字符，同一串交给那个世界；`TOWN_ALLOW` 填那个世界服务器的出口 IP，多个用英文逗号隔开（IPv4、IPv6 都行），只有这些 IP 能调；不填就只认钥匙 | 免费 |

确认：至少 `OPENROUTER_API_KEY`、`VOLC_API_KEY`、一个 `S_` 槽位、`VOLC_RTC_APP_ID`/`VOLC_RTC_APP_KEY`、`VIDU_KEY` 都拿到了，Vidu 和 OpenRouter 有余额。

## 4. 登记声音、形象、动作（在你电脑上）

在你电脑上做，生成的编号文件要跟着包一起传上服务器。先把要用的钥匙输进当前终端（不会留在文件和历史里）：

```bash
cd <包>/app
read -s VOLC_API_KEY && export VOLC_API_KEY
read -s VIDU_KEY && export VIDU_KEY
```

**声音**（花几分钱）：

```bash
node tools/volc-clone.mjs S_<槽位> /path/to/录音.wav /tmp/demo.mp3 "大家好，欢迎来我的直播间"
```

`S_<槽位>` 换成第 3 步买的槽位编号。把 `/tmp/demo.mp3` 发给**主播本人听**，不像就换一段更干净的录音重跑。像了，把槽位编号记下来，第 6 步填进 `DOUBAO_VOICE_ID`。

**形象**（不花积分，1–3 分钟）：

```bash
node tools/vidu-looks.mjs --idol <id>
```

它把 `public/art/<id>/looks/` 里的图传到 Vidu，编号写进 `idols/<id>/vidu-looks.json`（配置会自动读）。Vidu 90 天后会删掉形象，到期前（文件里 `expires`）加 `--force 1` 重跑并重新发版本（见“以后更新”）。

**动作**（可选，不花积分）：

```bash
node tools/vidu-actions.mjs --idol <id>
```

最后打印的 `VIDU_ACTION_LIB=...` 记下来，第 6 步填进去。不做也能播，只是动作少。

**试听语气**（可选，花几百字）：`DOUBAO_VOICE_ID=S_<槽位> node tools/voice-tones-sample.mjs --idol <id>`，听各种语气是不是她。

确认：`idols/<id>/vidu-looks.json` 存在且有 `s1`；主播听过 demo 说像。做完关掉这个终端。

## 5. 上传并安装

把整个包传到服务器（不要用会删东西的 `--delete`）：

```bash
cd <包>/.. && scp -r <包文件夹名> root@<服务器IP>:/root/open-yoki
```

然后在服务器上：

```bash
cd /root/open-yoki && sudo bash deploy/install.sh
```

已经有域名、准备开网页直播间的，改成 `sudo DOMAIN=你的域名 bash deploy/install.sh`，会一起装好 Caddy 和 HTTPS（也可以第 10 步再做）。

它会装 ffmpeg、Chrome（无头，画直播画面）、Node.js 22、Claude Code 命令行（心要用）、Caddy、Python 环境；建用户 `livehost`；把程序放到 `/opt/livehost/app`、广场发帖脚本放到 `/opt/livehost/ops`、心的模板放到 `/opt/livehost/heart-template`；从 `.env.example` 生成 `/etc/livehost/livehost.env`（最后写了 `ON_AIR=off`：试播通过前不会按时间表自己开播），并登记 systemd 服务（只登记，不启动）。可以重复跑，不会覆盖已经填好的设置；但 `/opt/livehost/app` 已经存在时不会再复制程序，程序更新走“以后更新”。

确认：脚本最后显示 `installed. next:`；`/usr/bin/node -v` 是 v22 以上；`google-chrome --version` 有输出；`ls /opt/livehost/app/idols/` 里有 `<id>`。

## 6. 填服务器上的设置

**主设置** `/etc/livehost/livehost.env`（`sudo nano /etc/livehost/livehost.env`），每行 `名字=值`，不加引号。每一行上面都有中文说明。至少填：

```
IDOL=<id>
AVATAR=vidu
OPENROUTER_API_KEY=...
VOLC_API_KEY=...
DOUBAO_VOICE_ID=S_<槽位>
VIDU_KEY=...
VOLC_RTC_APP_ID=...
VOLC_RTC_APP_KEY=...
```

再按需要填：`VIDU_ACTION_LIB`（第 4 步打印的）、`HEART_KEY_DS`、`HEART_KEY`/`HEART_BASE_URL`、X 的 5 个、`TIKHUB_KEY`、`COINANK_API_KEY`、`TOWN_KEY`。文件末尾 `# written by install.sh` 下面那几行（路径和 `ON_AIR=off`）不要动。

**广场发帖脚本的设置** `/etc/livehost/square.env`：广场发帖的钥匙写在**这个**文件里（发帖脚本只读它）：

```
SQUARE_OPENAPI_KEY=...
```

确认：`sudo grep -c '=.' /etc/livehost/livehost.env` 的数字比装完时多了（不要把文件内容打印出来）；`sudo stat -c '%a %U' /etc/livehost/livehost.env /etc/livehost/square.env` 都是 `600 root`。

**Telegram 群**（可选）：主程序只能写 `/var/lib/livehost`，所以放在那里：

```bash
sudo install -d -o livehost -g livehost -m 700 /var/lib/livehost/tg
sudo nano /var/lib/livehost/tg/bot.json
sudo chown livehost:livehost /var/lib/livehost/tg/bot.json && sudo chmod 600 /var/lib/livehost/tg/bot.json
echo 'TG_DIR=/var/lib/livehost/tg' | sudo tee -a /etc/livehost/livehost.env
```

`bot.json` 的样子（运营群和成员可以不写）：

```json
{ "token": "机器人 token", "chatId": -100粉丝群id, "botId": 机器人自己的数字id, "botUser": "机器人用户名",
  "family": { "chatId": -100运营群id, "members": { "运营的数字id": "称呼（一句介绍）" } } }
```

群 id、用户 id：把机器人拉进群、在群里说句话，然后在服务器上 `curl -s https://api.telegram.org/bot<token>/getUpdates` 看（这条命令会带 token，跑完清掉终端）。机器人要在 @BotFather 里 `/setprivacy` 设成 Disable 才能看到群里所有消息。粉丝群的话交给她的心回，要有心；运营群的秒回要有 `HEART_KEY_DS`。

## 7. 第一次启动

```bash
sudo systemctl start livehost livehost-post.timer livehost-facts.timer
journalctl -u livehost -n 40 --no-pager
```

看到 `livehost (<id>, show) on http://127.0.0.1:4370  model=true voice=true avatar=vidu` 就是起来了。`model`、`voice` 是 `false` 说明对应钥匙或声音编号没填好。心开没开看 `heart:` 开头的行；第一次启动会出现 `heart: new home from heart-template`，表示她的家 `/var/lib/livehost/heart/` 建好了。

第一次跑还会生成 `/var/lib/livehost/data/square-ingest.key`（接弹幕、交推流地址、发帖脚本共用的口令，第 8 步用）。

**以后改了设置文件或主播配置，都要重启**：`sudo systemctl restart livehost`。

确认：

```bash
curl -s 127.0.0.1:4370/api/health | python3 -m json.tool | head -60
```

有一大段 JSON。看里面 `routes`：每一项是 `{ "on": 开没开, "ok": 最近一次好没好, "err": 出错原因 }`。`model`、`voice` 要 `on: true`；`heart` 是 `true` 表示心开着。

## 8. 把弹幕接进来

服务器自己不登录币安，也不用浏览器读直播间。直播间里的弹幕、进场、礼物、关注、在线人数，由你们自己的程序（平台官方接口、机器人、自己写的脚本都行）发给服务器的两个接口，她就会像回网页直播间的弹幕一样回。接口的格式和例子见 README 的“把弹幕接进来”一节，这里只说怎么接上：

- 口令在 `/var/lib/livehost/data/square-ingest.key`，放在请求头 `x-square-key` 里。读弹幕的程序跑在别的机器上时，把这个文件拷过去（只给它，别贴到聊天里），并通过 HTTPS 域名（第 10 步）访问 `/api/ingest/comments` 和 `/api/ingest/room`。
- 弹幕：`POST /api/ingest/comments`，`{"items":[{"name":"昵称","text":"弹幕"}]}`，一次最多 20 条。
- 直播间：`POST /api/ingest/room`，`{"online":在线人数,"events":[{"type":"enter|follow|gift|tip|red|end|warning","name":"昵称","what":"礼物名"}]}`。
- 只有网页直播间、暂时不接平台弹幕也能播，她会回网页上的弹幕。

确认（在服务器上，口令只在这条命令里读，不打印）：

```bash
curl -s 127.0.0.1:4370/api/ingest/comments -H "x-square-key: $(sudo cat /var/lib/livehost/data/square-ingest.key)" \
  -H 'content-type: application/json' -d '{"items":[{"name":"测试","text":"你好呀"}]}'
```

回 `{"ok":true,"took":1}`。开着播的时候，她几秒内会回这一句。

## 9. 试播

先确认主播同意在广场开一场几分钟的测试直播（广场上的人能看到）。

1. 主播在币安广场的直播后台开一场直播，把**推流地址**和**推流密钥**发给你（密钥只用一次就行，别存进文件）。
2. 在服务器上交给主程序（密钥从标准输入进，不留在命令历史里），16:9 横屏：

```bash
cd /root/open-yoki
read -s KEY && printf '%s' "$KEY" | sudo bash deploy/set-square.sh rtmp://<推流地址> 1280x720; unset KEY
```

3. 临时让她开播：把 `livehost.env` 末尾的 `ON_AIR=off` 改成 `ON_AIR=on`，然后 `sudo systemctl restart livehost`。
4. 等 1 分钟，`sudo bash deploy/set-square.sh --status` 看推流在不在跑。用手机打开币安 App 去主播的广场直播间看画面、听声音；再用第 8 步的命令发一条测试弹幕（接好了平台弹幕的，直接在直播间里发），看她是不是在几秒内用自己的声音回答、口型对不对。

看完：把 `ON_AIR=on` 改回 `ON_AIR=off`，`sudo systemctl restart livehost`（推流停止、Vidu 挂断），主播在广场后台关掉直播间，再 `sudo bash deploy/set-square.sh --clear`。

确认：画面有、声音是她、弹幕有回应、改回 `ON_AIR=off` 后推流停了。哪一项不对，先看“常见问题”，**全部正常才进第 12 步**。

## 10. 可选：网页直播间和域名

主程序自带一个中英双语的网页直播间（看画面、起昵称发弹幕、看日记），只监听服务器本机。对外开放：

1. 域名解析到服务器 IP，服务器开放 80/443。
2. 第 5 步没带 `DOMAIN` 的，现在重跑：`cd /root/open-yoki && sudo DOMAIN=你的域名 bash deploy/install.sh`（会生成 `/etc/caddy/sites/livehost.caddy`，Caddy 自己申请 HTTPS 证书）。
3. 把域名填进 `idols/<id>/config.mjs` 的 `PLACES.site`，按“以后更新”发一个版本。

确认：浏览器打开 `https://你的域名`，中文和英文（切换按钮）、电脑和手机都看一眼，能看到她、能发弹幕。

## 11. 可选：推特、电台、外部世界

- **推特**：第 6 步填了 X 的 4 个用户钥匙后，她写的动态会同时发 X。只填 `X_BEARER_TOKEN` 时她只读推找话题。填了用户钥匙后她还会每 15 分钟看一次别人回她的推、挑着回（`X_REPLY=0` 关掉，`X_REPLY_POLL_MS` 改间隔，按次计费）。确认：`/api/health` 里 `x.post` 是 `true`（只填 Bearer 时只有 `x.read` 是 `true`）；第一条推等她的心自己写，别替她发。
- **外部世界**：要让她住进外部 AI 世界（比如 TwinOasis）时，填 `TOWN_KEY`、`TOWN_ALLOW` 和 `config.mjs` 的 `town`（世界名字、她在那里的身份、公开的名片、`hide` 里写不能让那边看到的名字）。那边用 `GET /api/town/host` 和 `POST /api/town/host/events`，请求头带 `x-town-key`，格式见 README。确认：`curl -s 127.0.0.1:4370/api/town/host -H "x-town-key: <TOWN_KEY>"` 回她的名片。不用就跳过。

- **电台**（可选）：两场直播之间，她只用声音、配一张静图开电台，放歌（歌放 `RADIO_SONG_DIR`，默认 `/var/lib/livehost/data/songs`）、聊天、回弹幕。电台的直播间也由主播自己在广场开，推流地址照第 9 步交给服务器，然后告诉服务器电台开了：`curl -s 127.0.0.1:4370/api/square/radio -H "x-square-key: $(sudo cat /var/lib/livehost/data/square-ingest.key)" -H 'content-type: application/json' -d '{"on":true}'`（关掉时发 `{"on":false}`）。`RADIO_DAILY_CHARS` 限制电台每天配音字数。`livehost-facts.timer` 每 2 小时把币安公开的活动公告交给电台，她回答活动问题只用这些。确认：`bash /opt/livehost/ops/radio-check.sh` 显示电台在跑、有回答。不用就跳过。

## 12. 正式开播

第 9 步全部正常后，删掉 `ON_AIR=off`，交回给时间表：

```bash
sudo sed -i '/^ON_AIR=off$/d' /etc/livehost/livehost.env
sudo systemctl restart livehost
```

之后每一场：

1. 开播时间前几分钟，主播在广场后台开好直播间，把新的推流地址和密钥交给服务器（第 9 步第 2 条的命令；你们自己的工具也可以调 `POST /api/square/push`，`{"url":"rtmp://…","key":"…"}`，请求头带 `x-square-key`）。每场的密钥都不一样，用旧的会黑屏。
2. 到点她自己开口、推画面；到了时间表的结束时间她道别、停止推流、挂断 Vidu（停止计费）。
3. 下播后主播在广场后台关掉直播间。

- 临时加播：`livehost.env` 里写 `ON_AIR=on` 再重启；恢复按时间表就删掉这一行再重启。
- 横屏 / 竖屏：交推流地址时最后一个参数写 `1280x720` 或 `720x1280`。

确认：到了时间表的开播时间，`sudo bash deploy/set-square.sh --status` 显示在推，广场直播间有画面；到点后自己停。

---

## 以后更新

改了主播配置、换了形象，或者更新了包：在你电脑上

```bash
cd <包> && LIVEHOST_SSH=root@<服务器IP> bash deploy/ship.sh 20261027a
```

版本号自己起，不重复就行。它先在你电脑上跑测试，打包 `app/` 和 `ops/`（不带钥匙和数据）传上去，服务器上 `release.sh` 再测一遍才切换，切换后健康检查不过会自动退回上一个版本。

## 服务一览

| 服务 | 做什么 |
|---|---|
| `livehost` | 主程序：嘴、声音、Vidu 画面、推流、网页直播间、心、发推、接弹幕和外部世界的接口 |
| `livehost-post.timer` | 每 2 分钟：把她想发的广场动态通过官方接口发出去（要 `SQUARE_OPENAPI_KEY`） |
| `livehost-facts.timer` | 每 2 小时：把币安公开的活动公告交给电台 |
| `livehost-tap-prune.timer` | 清理 3 天前的推流存档（只有设了 `SQUARE_TAP` 才有） |

日志：`journalctl -u <服务名> -n 50 --no-pager`。在不在跑：`systemctl status <服务名> --no-pager`。

## 常见问题

- **她不说话**：看 `/api/health` 的 `routes.model`（钥匙错、余额不够）。
- **没声音或声音不对**：看 `routes.voice`；`DOUBAO_VOICE_ID` 要是第 4 步复刻用的那个 `S_` 槽位。
- **广场上黑屏**：先确认交的是这一场的推流密钥（每场都换）；`sudo bash deploy/set-square.sh --status` 看推流在不在跑；主程序会自动重新推流。2 分钟还黑：`journalctl -u livehost -n 100 --no-pager | grep -i square`。常见原因是 Vidu 积分用完（`/api/health` 里有余额提醒）或没填 RTC 的两个钥匙。
- **弹幕进不来**：看你们读弹幕的程序日志；口令对不对（返回 403 就是口令错）；用第 8 步的命令手动发一条试试。
- **心没开**：`journalctl -u livehost | grep heart:` 看原因（没有 `HEART_KEY` 也没有 `HEART_KEY_DS`、`HEART_HOME` 不对）。
- **到点没开播**：`livehost.env` 里是不是还有 `ON_AIR=off` 或 `ON_AIR=on`；`/api/health` 里 `onAir` 的时间对不对（时区看配置里 `tz`）。
- **发动态没发出去**：`journalctl -u livehost-post -n 30 --no-pager`；`SQUARE_OPENAPI_KEY` 要写在 `square.env` 里，不是 `livehost.env`。
- **花费**：Vidu 是大头，只在开播且有人看时连线，下播立刻挂断。`TTS_DAILY_CHARS` 限制每天配音字数。

## 目录

```
<包>/
  README.md / README.en.md   介绍（中文 / English）
  SETUP.md                   本说明
  .env.example               全部设置项和说明（install.sh 复制成 /etc/livehost/livehost.env）
  app/                       主程序（Node.js）
    idols/example/           主播样板；复制成 idols/<id>/（config.mjs、profile.mjs、mouth.mjs、speech.mjs）
    public/art/<id>/looks/   形象图 s1.jpg
    server/                  代码
    tools/                   声音复刻、Vidu 形象和动作登记
    relay/                   服务器内部用的推流页面（直播画面）
    test/                    测试（npm test）
  heart-template/            心的家第一次建立时的模板
  ops/                       广场发帖脚本（Python，官方 OpenAPI）
  deploy/                    install.sh、set-square.sh、ship.sh、release.sh、systemd 服务、Caddy 模板
  tools/video/ tools/studio/ tools/debug/   剪片段、做素材、调试工具（各自有 README）
  docs/                      调试手册
```
