# checkup：每日体检 / daily checkup

每天下播后跑一遍：主程序在不在、心多久没动、今晚准时开播没有、有没有提前断、读弹幕有没有卡住、群里的话接没接、网站能不能打开、硬盘。能自己修的只修一件事：心卡住了就跑你配置的修复命令（直播时段不动），再查一次。没问题不打扰你，有问题或修过了才发消息。

```sh
cp checkup.example.json checkup.json      # 改成你的路径、日志、时间
python3 checkup.py --config checkup.json --dry          # 只看，不修、不发、不写报告
python3 checkup.py --config checkup.json                # 正式：修 + 写报告 + 有事才提醒
python3 checkup.py --config checkup.json --replay 2026-01-24   # 回放某天的直播检查
python3 selftest.py                                     # 离线自检
```

检查项类型（详见 `checkup.py` 开头注释）：`command`（任意命令，私有的检查都走这个：读弹幕浏览器登录、私有面板、另一台机器上的看门狗……）、`http`、`fresh`（文件多久没更新，可带修复命令和 `quiet_hours`）、`disk`、`count`（日志里某类行太多/太少）、`pair`（进来多少、回了多少）、`show`（开播时间、断流、提前下播、读弹幕最长空档）。提醒走 Telegram、webhook 或自定义命令，钥匙放环境变量。

定时：cron `20 21 * * * python3 /opt/my-host/checkup.py --config /etc/my-host/checkup.json`，或 systemd timer（`OnCalendar=*-*-* 13:20:00 UTC`，`Persistent=true`）。

English: run once a day after the show; it only alerts when something is wrong or was fixed. Check types are documented at the top of `checkup.py`; anything private to your setup becomes a `command` check.
