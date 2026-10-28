# heart-compare：心的新旧对比 / old vs new heart

从心的日志里挑几拍真实的输入（开播中、刚下播、白天一个人、想起某个人），在心的家目录**副本**上分别用旧设置和新设置各跑一遍，记下它说了什么、写了哪些文件、写成什么样、花了几秒。真家目录不会被碰。

```sh
node run.mjs --home /path/to/heart-home --beats example/beats.json \
  --a "sh example/run-heart.sh" --b "sh example/run-heart.sh" --b-overlay new-rules/ --out out
node selftest.mjs
```

`--a/--b` 是“跑一拍心”的命令：家目录副本在 `$HEART_HOME`，空的状态目录在 `$HEART_STATE`，这一拍的输入从标准输入进，输出就是它说的话。`--b-overlay` 里的文件会盖到 B 的副本上（例如新的说明书）。

English: replay real heart beats on scratch copies of the heart's home with two setups; see what each said and which files it wrote.
