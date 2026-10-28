# facts-align：小抄对齐 / facts align

主播往往不止一张嘴：直播的主程序、群里秒回的小模型、发帖的、回推的，各自带一份小抄。心里记住了新事（或者你改了一个决定），某张小抄没跟上，她就会在另一个地方说出相反的话。

```sh
cd example
node ../align.mjs facts.json            # 静态：每份小抄里每条事实在不在、有没有说反
node ../align.mjs facts.json --probe    # 再拿几个问题去问每条通道，看回答（会调用模型）
node ../selftest.mjs
```

`facts.json` 里每条事实写“该出现的说法”（any）和“说反了的说法”（not）；标 `truth` 的来源是事实的出处。退出码非 0 表示有问题，可以放进部署前检查。

English: check that every cheat sheet carries every key fact and none contradicts it; optionally probe each reply path with questions.
