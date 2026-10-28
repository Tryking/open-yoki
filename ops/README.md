# ops：发广场动态、电台的说话素材

Node 服务器（`app/`）就是主播本人：她说话、做直播画面、决定发什么。`square_post.py` 把她排好的动态通过广场官方 OpenAPI 发到广场；
`facts.py` 把币安最新的活动公告（公开网页，不用登录）交给两场直播之间的电台，这样她不会编造奖励。

| 单元 | 做什么 |
| --- | --- |
| `livehost.service` | Node 服务器（`/opt/livehost/app`，用户 `livehost`，设置文件 `/etc/livehost/livehost.env`） |
| `livehost-post.timer`（2 分钟） | `square_post.py`：把主播排好的动态（`GET /api/square/outbox`）通过 OpenAPI 发出去，再回报结果（`POST /api/square/outbox/done`）。需要 `SQUARE_OPENAPI_KEY`（在广场创作者中心生成）；没有它，广场上什么都不会发。X 由服务器自己通过 X 官方 API 发 |
| `livehost-facts.timer`（2 小时） | `facts.py`：把币安公开的活动公告交给服务器（`POST /api/square/facts`），电台回答活动相关问题只看这一个来源 |

弹幕、观众和礼物从服务器的弹幕接入接口进来，由读你直播间的程序送过来。见主 README 里的
“把弹幕接进来”。

两场直播之间的电台（server/radio.mjs、`relay/radio.html`）把只有声音的直播流推到服务器保存的 RTMP 地址。在广场上开播、下播这场电台要你自己来（手动，或者用你自己的工具），然后用
`POST /api/square/radio` 告诉服务器。`bash ops/radio-check.sh [minutes]` 会打印电台最近的情况。

## 设置

`conf.py` 先读 `/etc/livehost/square.env`，再读环境变量：`SERVER_URL`（默认 `http://127.0.0.1:4370`）、
`INGEST_KEY_FILE`（默认 `/var/lib/livehost/data/square-ingest.key`，服务器第一次启动时生成，放在
`x-square-key` 里发）、`SQUARE_OPENAPI_KEY` 和 `SQUARE_LANG`（公告列表的语言，默认 `zh-CN`）。

## Python

Python 3.9+，只用标准库。`deploy/install.sh` 会在 `ops/venv` 给它建好虚拟环境。

```
python3 ops/square_post.py check    # 看 OpenAPI 钥匙在不在
python3 ops/square_post.py          # 跑一次
python3 ops/facts.py                # 取一次公告
```
