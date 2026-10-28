# dance/ — your character dancing

| Command | Service | When | Cost |
| --- | --- | --- | --- |
| `driver <dance.mp4>` | none (offline) | before anything: is this a good driving video? | free |
| `frame <char> <video> [--box t,b,l,r]` | none with `--box`, else OpenRouter finds the dancer | preview the head-to-knees 9:16 crop | free / <$0.01 |
| `bind <char> <look> <dance.mp4>` | fal, Kling 3.0 motion control + bound face | **default**: must follow the steps exactly, full body OK | ~$0.168/s (pro), $0.126/s (`--std`); 10 s ≈ $1.7, ~6 min |
| `o3 <char> <look> <dance.mp4>` | LibTV, Kling O3 multi-reference | best-looking face in half-body shots; follows steps more loosely | LibTV credits, 10–15 min per 10 s |
| `viggle <char> <look> <dance.mp4>` | Viggle | quick character swap with transparent background | Viggle credits |

Every generation ends with an automatic face check (`check/face.mjs`); `--no-check` skips it. `--dry-run` prints the plan and cost.

## What we learned (the hard way)

| Tried | Result |
| --- | --- |
| Full-body motion transfer, no face help | Moves fine, face ugly: the face is a few dozen pixels and becomes an "average face" (smaller eyes, heavier makeup, empty stare). High-quality mode doesn't fix it. |
| Face swap / video face edit afterwards | Rejected by moderation, or almost no change. |
| Crop head-to-knees + Kling O3 with master face → look photo → standing body + driving video | Good face, good looks. The `o3` route. |
| Kling 3.0 motion control **with the face bound** (master face + two 3/4 sides) | Eyes, bangs, face shape come back even full-body to the feet. The `bind` route, default. |

Rules:
- **Dance standing.** A seated "dance" reads as a glitch. Drivers: standing, facing the camera, no spins or hair flips.
- **Choose the driver, not the prompt.** Motion transfer copies the dancer's expression (pouts, O-mouths, grimaces); "closed-mouth smile" in the prompt does not override it. A blank-faced dancer gives a blank face. Pick a dancer who smiles and blinks naturally. A trending dance people recognise beats an original one.
- Kling O3 does max 10 s per call; longer dances are split and seams can jump. Look at the seams.
- Some crops make Kling refuse with "generation failed" for no stated reason; `o3` automatically steps to a looser crop, then no crop. Failed credits usually come back.
- Fast hands blur in every model. The face check only looks at faces; hands need a human eye.
- Music: the dance video's own audio is put back by default (`--music` to replace). Licensing of that music is your responsibility.

## 中文

跳舞默认走 `bind`（fal 可灵 3.0 动作迁移 + 绑定主脸和两张 3/4 侧脸，10 秒约 1.7 美元），半身更好看可以走 `o3`（LibTV 可灵 O3，主脸 → 造型照 → 站姿 + 驱动视频，框到膝盖），`viggle` 是快速换人。每次出片自动验脸。经验：必须站着跳；选驱动视频比写提示词重要（会照搬原舞者的表情，挑正面、半身、不转圈、表情自然的热门舞）；O3 一段最长 10 秒，接缝要看；手部快动作会糊要人眼看；音乐版权自负。
