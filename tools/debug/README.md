# 调试工具 / Debug tools

配合 [调试手册](../../docs/debug.md)（[English](../../docs/debug.en.md)）用。每个工具一个目录，都能先用假数据自检：

```sh
sh selftest-all.sh      # 全部离线自检，不联网、不花钱 / all offline self-tests, no network, no cost
```

| 工具 / tool | 管什么 / what for | 手册章节 | 运行环境 |
|---|---|---|---|
| [checkup](checkup/) | 每天体检：服务、心跳、开播、群聊回没回、网站、硬盘；私有检查写成命令接进来 / daily checkup | 6 | Python 3.8+ |
| [line-lint](line-lint/) | 台词磨损：说腻的词和数、开头结尾重复、免责话、说教、抱怨没人、语言没跟上、冷场 / worn words, repeats, disclaimers, wrong language | 3 | Node 18+ |
| [model-blind](model-blind/) | 换模型盲比：同一批场景几家模型各说一句，打乱了让人选 / blind model comparison | 3 | Node 18+ |
| [mouth-compare](mouth-compare/) | 嘴的新旧对比：同一批场景，两套人设/心里话/模型并排 / old vs new mouth | 3 | Node 18+ |
| [capture](capture/) | 抓真实请求：看外壳到底给模型塞了什么（system 多长、工具、温度、思考模式）/ see what really goes to the model | 2 | Node 18+ |
| [heart-compare](heart-compare/) | 心的新旧对比：同一批真实心跳，在副本上重放，看说了什么、写了哪些文件 / old vs new heart | 2 | Node 18+ |
| [facts-align](facts-align/) | 小抄对齐：几个说话的地方（直播、群聊秒回、发帖）知道的事是否一致 / do all mouths know the same facts | 2, 8 | Node 18+ |
| [voice-audition](voice-audition/) | 声音情绪试听：分段合成、拼接、量起伏、盲听打标签、查字准、出试听串 / emotional voice audition | 4 | Node 18+（非 WAV 要 ffmpeg） |
| [frame-check](frame-check/) | 画面：每 20 秒真动了几帧、卡在哪；脸和定妆照并排的对照图 / stutter windows, face side-by-side sheet | 5 | Python 3.8+ + ffmpeg |
| [distill-prep](distill-prep/) | 从真人主播蒸馏：切片、每 2 秒截帧拼图、转写、笔记模板 / prep material for distilling a real streamer | 7 | Python 3.8+ + ffmpeg |

钥匙只从环境变量读（配置里写变量名，不写值），工具不会打印钥匙。会花钱的只有你自己配置的模型和配音接口；先用 `provider: "mock"` / `engine: "mock"` 跑通再换真的。

Keys are only read from environment variables named in the configs and are never printed. Only the model and TTS endpoints you configure cost money; run everything with the mock provider first.
