# model-blind：换模型盲比 / blind model test

同一批直播场景（弹幕、冷场、快讯、接着说）用同一份人设交给几家模型，各说一句；页面每题打乱顺序，让人只凭“哪句像真人”选，最后才揭晓是谁、平均几秒一句、花了多少钱。

```sh
cd example
node ../run.mjs --candidates candidates.json --moments moments.json --out ../out   # 会调用你配置的模型（花钱）
node ../run.mjs --answers my-answers.json --out ../out                             # 答案你自己收集好，只出页面
node ../selftest.mjs
```

候选可以是任何 OpenAI 兼容接口（`provider: "openai"`，钥匙写环境变量名），也可以是 `provider: "command"`：把你自己的主程序包一层，读标准输入的 JSON、打印一句话。这样比的是“整条嘴”，不只是裸模型。选人看：找不知道答案的人来选，每家至少 12 题。

English: blind A/B/C of models on the same moments; the page shuffles per moment and only reveals the key at the end.
