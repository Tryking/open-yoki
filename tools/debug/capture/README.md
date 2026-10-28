# capture：抓真实请求 / capture the real request

判断“这个模型行不行”之前，先看一次真正发给模型的是什么。很多外壳（尤其是编程 agent 一类）会在你的人设前面塞几万字它自己的说明和工具列表、打开思考模式、不设温度；人设只是最后追加的一句。这时候换哪家模型都还是一个味。

```sh
node capture.mjs --port 8787 --out captured.jsonl     # 起一个假接口
# 把主程序 / 心的接口地址临时改成 http://127.0.0.1:8787，跑一拍
node capture.mjs --show captured.jsonl                # 看：system 多长、开头是什么、几个工具、温度、思考
node selftest.mjs
```

授权头不会被写进文件。English: a fake OpenAI/Anthropic-style endpoint that records what your app really sends (minus auth headers) and summarizes system prompt size, tools, temperature and thinking settings.
