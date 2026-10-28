# line-lint：台词磨损检查 / line lint

拿一场直播里她真说出口的话，找出让人觉得“像机器”的习惯：一个数或一个词说了一晚上、开头结尾老一样、免责话、说教、“没人理我”、别人用英文问她用中文答、每句先叫对方名字、每句一样长、某个表情标签用太多、冷场太久。

```sh
node lint.mjs show.jsonl --md report.md          # 一行一个 {"at","who":"host|viewer","name","text","to"}
node lint.mjs lines.txt                          # 或者一行一句她说的话
node lint.mjs show.jsonl --config lint.config.example.json --json report.json
node selftest.mjs
```

`lint.mjs` 也导出 `wornTopics` / `wornReply` / `wornNote` / `repeatOf` / `langOf`，主程序出话前可以用同一套规则（说腻了就提示换话题，跟最近几句重了就重写一次，外语弹幕提示用对方的语言）。

English: lint a show transcript for worn words/numbers, repeated openings/endings, disclaimers, sermons, "nobody is here", wrong-language replies, name-calling, uniform length, tag overuse and dead air. The same helpers are exported for use inside your brain.
