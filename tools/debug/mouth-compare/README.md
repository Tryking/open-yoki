# mouth-compare：嘴的新旧对比 / old vs new mouth

同一批场景走两套设置（旧人设 vs 新人设、带不带心里话、换模型），并排写进 `compare.md`，下面附两边的台词磨损数字（平均长度、问句比例、重复、免责话等）。

```sh
cd example
node ../run.mjs --a old.json --b new.json --moments ../../model-blind/example/moments.json --out ../out
node ../selftest.mjs
```

一次只改一样东西，才知道是哪样起的作用。看 `compare.md` 时先自己读一遍，再交给不知道哪边是新的那个人读。

English: run the same moments through two mouth setups and put them side by side with lint numbers. Change one thing at a time.
