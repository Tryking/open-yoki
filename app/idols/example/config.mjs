// The example host's show: how she moves, sounds and runs her nights. Who she is lives in profile.mjs; the prompts
// are built from it in mouth.mjs. To make your own host, copy this folder to idols/<your-id>/, fill profile.mjs and
// the PLACES below, upload her look (app/tools/vidu-looks.mjs) and set IDOL=<your-id>.
// No coin: no chain, wallets, stages or fan club; everyone comes in with a nickname.
import fs from 'node:fs';
import P from './profile.mjs';
import { personaFor, mouthFor, directFor, examplesFor } from './mouth.mjs';

// Where people find her. Leave '' for anything she does not have yet; the prompts and the web page skip empty ones.
const PLACES = {
  square: { name: '', handle: '' },   // Binance Square: display name and the handle in her profile link
  x: '',                              // X handle without @
  site: '',                           // her web room's domain, e.g. example.com
  tg: { group: '', link: '' },        // Telegram fan group name and https://t.me/... invite link
  showTime: '每晚 8 点到 10 点',       // said when someone asks when she is live
};

// Her look(s) uploaded once as Vidu avatar assets (app/tools/vidu-looks.mjs --idol <id> --src <folder>) are written
// to vidu-looks.json next to this file. VIDU_AVATAR_ID in the env works too for a single look.
const viduLooks = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('./vidu-looks.json', import.meta.url), 'utf8')).ids; } catch { return {}; }
})();

export default {
  id: 'example',
  coin: false,
  name: P.name,
  nameEn: P.nameEn,
  short: P.short,
  ticker: '',
  square: PLACES.square,
  x: PLACES.x || null,
  site: PLACES.site,
  tg: PLACES.tg,
  show: PLACES.showTime,   // when she is live, said to fans and other places
  lang: 'zh',
  tz: 8,                    // her time zone (hours from UTC); schedule, diary and clocks use it
  tzName: '北京时间',        // how she says it

  watchedOnly: { graceMs: 90e3 },   // Vidu bills by connected time: only keep the avatar on while someone watches
  born: P.born,             // her first show: she counts her days from here (brain.soulFor)
  // One "stage" so the shared code has a look to show. `look` is what she may say about her room and clothes.
  stages: [{ key: 's1', name: '深夜', usd: 0, look: '深夜的小房间里，屏幕的光照着你；你穿着宽松的针织开衫，长直发，窝在沙发上看盘' }],

  // Everyday moves for a seated, front-camera close-up. `vidu` is the short prompt sent with a line; `lib` is the
  // longer description used to build the Vidu action library once (app/tools/vidu-actions.mjs).
  actions: {
    // Cute poses for a guest arriving, a gift or goodbye; each one is also a 点播 (request) button on the web page.
    挥手: { fx: 'wave', vidu: '开心地对镜头挥手打招呼', lib: '举起右手对镜头左右挥动打招呼，笑得很开心' },
    比心: { fx: 'heart', vidu: '双手在胸前比一个爱心，歪头微笑', lib: '双手在胸前合成一个爱心形状，歪头微笑，一秒后把手放下' },
    眨眼: { fx: 'wink', vidu: '对着镜头俏皮地眨一下眼', lib: '对着镜头俏皮地眨一下左眼，同时比一个剪刀手放在脸旁' },
    捂脸: { fx: 'shy', vidu: '用双手捂住脸，从指缝里偷看', lib: '害羞地用双手捂住整张脸，再张开手指从指缝里偷看镜头' },
    飞吻: { fx: 'kiss', vidu: '对着镜头送出一个飞吻', lib: '右手指尖轻碰嘴唇，再把手掌朝镜头方向推出去送一个飞吻，嘟嘴后甜甜一笑' },
    撒娇: { fx: 'pout', vidu: '嘟嘴，双手握拳放在下巴前轻轻晃', lib: '双手握拳放在下巴下面，嘟起嘴巴，身体左右扭两下，眼睛眨巴眨巴看着镜头' },
    // Everyday moves of someone talking at a desk (daily = not a request button; quiet = only while she is silent,
    // because drinking or stretching mid-sentence covers the mouth). Almost every line gets one of these.
    点头: { daily: true, vidu: '一边听一边轻轻点两下头', lib: '看着镜头轻轻点了两下头，嘴角带笑，像在认真听人说话' },
    歪头: { daily: true, vidu: '歪着头想了一下', lib: '歪着头想了一下，眼睛往上看，一根手指轻轻点着下巴' },
    看手机: { daily: true, vidu: '低头看了一眼桌上的手机', lib: '低头拿起桌上的手机看了几秒，用拇指往上划了划，再抬头看镜头' },
    看屏幕: { daily: true, vidu: '凑近盯着屏幕看', lib: '身体往前凑近，微微眯眼盯着镜头前的电脑屏幕看，像在看行情' },
    指屏幕: { daily: true, quiet: true, vidu: '用手指点了点屏幕', lib: '右手放在右肩旁边，食指朝自己右边的方向点了两下，眼睛也跟着往右边看，像在指旁边的屏幕' },
    后仰笑: { daily: true, vidu: '往后一靠笑出来', lib: '身体往后一靠笑出来，肩膀跟着抖，一只手轻轻拍了下桌子' },
    托腮: { daily: true, vidu: '手托着下巴', lib: '一只手肘撑在桌上，手托着下巴，懒懒地看着镜头' },
    撩头发: { daily: true, vidu: '把头发拨到耳后', lib: '抬手把脸旁的长发拨到耳朵后面，再放下手' },
    摊手: { daily: true, vidu: '摊开两手耸耸肩', lib: '两只手在胸前摊开，耸了耸肩，一脸无奈' },
    摇头: { daily: true, vidu: '无奈地摇摇头', lib: '轻轻摇了摇头，叹了口气，表情有点无奈又好笑' },
    伸懒腰: { daily: true, quiet: true, vidu: '伸了个懒腰', lib: '双手不抬起来，只是肩膀往上耸一下再往后转一圈，脖子左右轻轻歪一下，像坐久了活动筋骨' },
    // Feelings that show on her face and hands; a line's move follows its mood (moods below).
    捧脸笑: { daily: true, vidu: '被逗笑了，双手捧着脸笑', lib: '被逗笑了，双手轻轻捧住两边脸颊，眼睛笑得弯起来，身体跟着轻轻晃了一下，再慢慢放下手' },
    惊讶: { daily: true, vidu: '吃了一惊，眼睛睁大', lib: '眼睛一下睁大，眉毛扬起来，身体往后一缩，愣了一秒然后笑了' },
    叹气: { daily: true, vidu: '轻轻叹了口气', lib: '轻轻叹了口气，肩膀垂下来，低头看了一眼自己的手，再慢慢抬起头' },
    撇嘴: { daily: true, vidu: '撇撇嘴，有点不服气', lib: '撇了撇嘴，眼睛往旁边一瞥，头轻轻往一边偏了一下，一脸不服气' },
    得意笑: { daily: true, vidu: '抬起下巴得意地笑', lib: '下巴微微抬起，嘴角翘起来，眼神有点小骄傲地看着镜头，轻轻点了一下头' },
    发呆: { daily: true, quiet: true, vidu: '双手托腮发呆', lib: '两只手托着下巴，眼睛放空看着前方发了一会儿呆，慢慢眨了两下眼，又回过神来' },
    // Micro-expressions (micro): a second or two, eyes, brows and mouth only, so she can make one mid-sentence.
    抿嘴笑: { daily: true, micro: true, vidu: '抿着嘴笑了一下', lib: '嘴唇轻轻抿住，嘴角往上翘了一下，眼睛跟着微微弯起来，一两秒后恢复，头和手都不动' },
    眯眼笑: { daily: true, micro: true, vidu: '眼睛笑得眯起来', lib: '眼睛笑得眯成一条缝，眼角挤出一点细纹，脸颊鼓起来，嘴角上扬，头轻轻往后一点点，手不动' },
    憋笑: { daily: true, micro: true, vidu: '想笑又憋着', lib: '嘴角忍不住往上跑又压回去，嘴唇抿紧，眼睛往下瞟了一下，肩膀轻轻抖了一下，憋着没笑出来' },
    低头笑: { daily: true, micro: true, vidu: '低头笑了一下又抬起来', lib: '视线往下落，低头笑了一下，下巴微微收，一秒后抬眼重新看镜头，手不动' },
    眼睛一亮: { daily: true, micro: true, vidu: '眼睛一下亮了', lib: '眼睛一下睁大一点，眉毛轻轻往上抬，嘴微微张开，像看到好东西，头往前探了一点点' },
    挑眉: { daily: true, micro: true, vidu: '俏皮地挑了一下眉', lib: '一边眉毛俏皮地往上挑了一下，嘴角带一点坏笑，眼睛看着镜头，头稍微歪一点' },
    愣一下: { daily: true, micro: true, vidu: '愣了一下，眨了两下眼', lib: '表情停住愣了一秒，眼睛快速眨了两下，眉毛微微抬起，然后回过神来，身体不动' },
    往上看想: { daily: true, micro: true, vidu: '眼睛往上看，在想', lib: '头和下巴都不动，只有眼珠往左上方瞟了一下，嘴唇轻轻嘟起一点，像在回想一件事，一秒后眼睛回到镜头' },
    眯眼琢磨: { daily: true, micro: true, vidu: '微微眯眼琢磨', lib: '眼睛微微眯起来，眉头轻轻往中间靠，嘴巴抿成一条线，像在琢磨一件事，头不动' },
    斜眼瞄: { daily: true, micro: true, vidu: '斜着眼瞄了一下', lib: '眼睛往旁边斜着瞄了一下，嘴角半笑不笑，有点狐疑又有点逗，然后眼神回到镜头' },
    小白眼: { daily: true, micro: true, vidu: '俏皮地翻了个小白眼', lib: '眼珠往上轻轻翻了个小白眼，嘴角憋着笑，头微微一偏，不是生气，是开玩笑的那种' },
    嘴角一撇: { daily: true, micro: true, vidu: '嘴角一撇', lib: '一边嘴角往下撇了一下，眉毛轻轻一皱又松开，有点不以为然，头不动' },
    坏笑: { daily: true, micro: true, vidu: '嘴角一边勾起来坏笑', lib: '只有一边嘴角勾起来，眼睛微微眯着看镜头，带点小得意和小坏，头稍微低一点' },
    眼神变软: { daily: true, micro: true, vidu: '眼神软下来，轻轻笑', lib: '眉眼一下柔和下来，眼神变软，嘴角带一点很轻的笑，头往一边轻轻歪一点，像在心疼人' },
    抿嘴点头: { daily: true, micro: true, vidu: '抿着嘴轻轻点头', lib: '嘴唇抿住，眉头微微皱着，慢慢点了一下头，像在认真听对方难过的事' },
    皱眉: { daily: true, micro: true, vidu: '轻轻皱了下眉', lib: '眉头轻轻皱起来，眼睛看着镜头，嘴微微抿着，有点担心，一两秒后慢慢松开' },
    瞪一眼: { daily: true, micro: true, vidu: '假装生气瞪了一眼', lib: '眼睛睁圆假装生气地瞪了镜头一眼，下巴微微收，嘴抿着，一秒后自己先绷不住笑了' },
    不好意思笑: { daily: true, micro: true, vidu: '不好意思地笑，眼神躲开', lib: '不好意思地笑了，眼神往下往旁边躲开，下巴往肩膀那边收一点，一秒后又偷偷看回镜头' },
    认真听: { daily: true, micro: true, vidu: '认真听，慢慢眨眼', lib: '眼睛专注地看着镜头，慢慢眨了一下眼，眉毛微微抬起，嘴角放松，像在认真听人说话，头不动' },
    瞄弹幕笑: { daily: true, micro: true, vidu: '低头瞄一眼弹幕，笑了', lib: '眼睛往下瞄了一眼镜头前的屏幕，看到什么好笑的，嘴角慢慢翘起来，再抬眼看镜头' },
    轻轻叹: { daily: true, micro: true, vidu: '轻轻呼了口气', lib: '轻轻呼出一口气，肩膀微微一松，眼睛慢慢眨了一下，嘴角很淡地笑了一下，有点无奈' },
    鼓腮: { daily: true, micro: true, quiet: true, vidu: '鼓了一下腮帮子', lib: '腮帮子鼓起来一下，眼睛往旁边看，像有点小不满，一秒后泄气松开' },
    // More hands and feelings, each tied to a moment (shades below), so the same two moves do not fill a whole night.
    摸下巴: { daily: true, vidu: '摸着下巴琢磨', lib: '一只手的拇指和食指捏着下巴轻轻摸了摸，眼睛往旁边看，像在认真琢磨一件事' },
    双手合十: { daily: true, vidu: '双手合十祈祷', lib: '双手在胸前合十，闭了一下眼睛又睁开，嘴唇动了动像在小声念叨，像在求行情别砸' },
    握拳加油: { daily: true, vidu: '握拳打气', lib: '右手握拳在胸前用力往下一挥，眼睛发亮，嘴角上扬，像在给自己和大家打气' },
    拍手: { daily: true, vidu: '开心地拍手', lib: '双手在胸前开心地快速拍了几下，笑得眼睛弯起来，身体跟着轻轻晃' },
    竖大拇指: { daily: true, vidu: '对镜头竖大拇指', lib: '对着镜头竖起右手大拇指，轻轻点了一下头，一脸“可以啊”的表情' },
    嘘: { daily: true, quiet: true, vidu: '食指放嘴前嘘一下', lib: '右手食指竖起来轻轻放在嘴唇前，眼睛往旁边瞄了一下，做出“嘘，这个不能说”的样子，再放下手' },
    凑近镜头: { daily: true, vidu: '凑近镜头说悄悄话', lib: '身体往前凑近镜头，头稍微压低，眼睛往两边瞄了一下，像要跟你说悄悄话' },
    扶额: { daily: true, vidu: '扶着额头摇头', lib: '一只手扶住额头，低头轻轻摇了摇，又好气又好笑，然后放下手看镜头' },
    捂心口: { daily: true, vidu: '手按心口，被暖到', lib: '一只手轻轻按在心口，眼神变软，嘴角带着笑，像被暖到了' },
    托腮笑: { daily: true, vidu: '托着腮冲镜头笑', lib: '一只手托着腮，头歪向一边，冲镜头甜甜地笑，眨了一下眼' },
    抱胸: { daily: true, vidu: '双手抱胸，不服气', lib: '两只手臂在胸前交叉抱起来，下巴微微抬起，眼神有点不服气又憋着笑' },
    捂嘴笑: { daily: true, quiet: true, vidu: '捂着嘴偷笑', lib: '用一只手的手背挡住嘴偷偷笑，肩膀轻轻抖，眼睛笑弯了' },
    打哈欠: { daily: true, quiet: true, vidu: '捂嘴打个小哈欠', lib: '眼睛眯起来，抬起右手手掌捂住嘴巴，脸一直正对镜头，打个小哈欠后放下手眨眨眼' },
    喝水: { daily: true, quiet: true, vidu: '拿杯子喝一口水', lib: '拿起桌上的杯子喝了一小口，放下杯子，抿了抿嘴唇' },
    // Seated party moves. trial = still being checked frame by frame on the avatar; off by default.
    手势舞: { vidu: '在脸旁边做手势舞', lib: '双手在脸两侧先比一朵小花托住下巴，再双手比一个小爱心，最后双手剪刀手放在脸旁边，手一直在脸附近，像在做手势舞' },
    剪刀手: { vidu: '脸旁比剪刀手', lib: '右手在右脸旁边比一个剪刀手，歪头笑着眨一下眼，一秒后放下' },
    转椅子: { quiet: true, trial: true, vidu: '坐着转一下椅子', lib: '身体连同椅子往左边转到侧面，露出侧脸停一下，然后马上转回来正对镜头笑，始终不背对镜头' },
    // Standing moves: only on a standing look (vidu-looks keys stand-*), a separate full-body picture.
    站着挥手: { quiet: true, trial: true, stand: true, vidu: '站着挥手打招呼', lib: '站着面对镜头，抬起右手在头旁边开心地左右挥几下，身体跟着轻轻晃，然后把手放下' },
    站着转圈: { quiet: true, trial: true, stand: true, vidu: '原地转一圈', lib: '站在原地，双脚小步踩着慢慢转一圈，只转一圈，转回来正对镜头后就停住不再转，双手摊开笑着' },
    站着跳舞: { quiet: true, trial: true, stand: true, vidu: '站着跳一小段舞', lib: '站在原地跳一小段可爱的舞：双脚左右踏步，膝盖跟着节拍弯一弯，双手握拳在胸前左右摆，肩膀一上一下，最后双手比一个大爱心停住' },
    踏步拍手: { quiet: true, trial: true, stand: true, vidu: '踏步拍手', lib: '站着原地左右踏步，双手在胸前跟着拍子拍手，头一点一点，脸上一直在笑' },
    站着比心: { quiet: true, trial: true, stand: true, vidu: '站着举手比大心', lib: '站着把两只手臂举过头顶，弯成一个大大的爱心，歪头笑一下，再把手放下' },
    鞠躬: { quiet: true, trial: true, stand: true, vidu: '鞠躬谢谢', lib: '站着双手放在身前，弯腰鞠一个躬，抬起头笑着看镜头' },
  },
  // Which moves fit which feeling. A line's move must be one of its mood's (brain.moveFor): a sad line never comes
  // with a grin.
  moods: {
    happy: ['后仰笑', '捧脸笑', '剪刀手', '手势舞', '点头', '眨眼', '抿嘴笑', '眯眼笑', '憋笑', '低头笑', '眼睛一亮', '瞄弹幕笑', '挑眉', '拍手', '竖大拇指', '托腮笑'],
    shy: ['捂脸', '撩头发', '不好意思笑', '低头笑', '抿嘴笑', '憋笑', '捂心口'],
    sad: ['叹气', '托腮', '眼神变软', '抿嘴点头', '皱眉', '轻轻叹'],
    angry: ['撇嘴', '摊手', '嘴角一撇', '瞪一眼', '小白眼', '斜眼瞄', '抱胸', '扶额'],
    smug: ['得意笑', '坏笑', '挑眉', '斜眼瞄', '眯眼笑', '抱胸', '竖大拇指'],
    neutral: ['点头', '歪头', '认真听', '往上看想', '眯眼琢磨', '愣一下', '瞄弹幕笑', '抿嘴笑', '摸下巴', '撩头发'],
  },
  // Finer feelings inside a face: what she wrote after 想 (or, failing that, the line's tone) picks the moves, so a
  // calm-tagged line that is really curious, bored or teasing looks like it (brain.shadeOf).
  shades: {
    curious: [/好奇|奇怪|纳闷|想知道|琢磨|疑惑|怀疑|咦/, ['歪头', '摸下巴', '往上看想', '眯眼琢磨', '眼睛一亮', '愣一下']],
    bored: [/无聊|困|懒|没劲|乏|累|发呆|走神/, ['托腮', '轻轻叹', '撩头发', '往上看想', '眯眼琢磨']],
    helpless: [/无语|无奈|服了|离谱|哭笑不得|没办法|又来/, ['摊手', '摇头', '扶额', '小白眼', '轻轻叹', '嘴角一撇']],
    tease: [/逗|坏|调皮|使坏|看戏|吃瓜|偷乐|偷笑|嘚瑟|损/, ['坏笑', '挑眉', '眨眼', '斜眼瞄', '憋笑', '托腮笑']],
    hope: [/期待|盼|紧张|祈祷|希望|等着|押|赌|别砸|忐忑/, ['双手合十', '眼睛一亮', '握拳加油', '眯眼琢磨']],
    excited: [/激动|兴奋|来劲|爽|嗨|冲|起飞|痛快/, ['拍手', '握拳加油', '后仰笑', '眼睛一亮', '竖大拇指', '捧脸笑']],
    warm: [/心疼|感动|暖|感激|舍不得|谢谢|贴心/, ['捂心口', '眼神变软', '抿嘴点头', '比心', '低头笑']],
    surprised: [/惊|哇|吓|没想到|居然|竟然|卧槽|真的假的/, ['惊讶', '愣一下', '眼睛一亮', '捂心口']],
    secret: [/秘密|不能说|悄悄|八卦|小道/, ['凑近镜头', '斜眼瞄', '坏笑', '挑眉']],
  },
  // A calm line with no telling feeling still takes its tone's moves (brain.shadeOf).
  toneShade: { 八卦: 'secret', 吐槽: 'helpless', 叹着气: 'helpless', 疑惑: 'curious', 慵懒: 'bored', 偷乐: 'tease', 热情: 'excited', 温柔: 'warm' },
  // What she does between lines, like a real host waiting for the next comment (avatar.mjs fidget). Mostly small
  // things (a glance at the chat, a thought, a breath), the bigger ones less often, so the gaps look like someone
  // sitting there and not a loop of poses. A quiet room for lonelyMs and she drifts off.
  fidget: { moves: ['瞄弹幕笑', '认真听', '往上看想', '看屏幕', '抿嘴笑', '轻轻叹', '眯眼琢磨', '鼓腮', '看手机', '撩头发', '托腮', '摸下巴', '托腮笑'], afterMs: [6e3, 13e3], lonely: ['发呆', '托腮', '看手机', '发呆'], lonelyMs: 90e3 },
  // Reading a new comment she leans in while she thinks of an answer; the answer's own move goes out reactLeadMs
  // before her voice, so her face reacts first and the words follow (avatar.mjs).
  notice: ['看屏幕', '瞄弹幕笑', '认真听', '凑近镜头'],
  // The sound she makes the instant a comment lands (filler.mjs), picked by what it is about, made once in her own
  // voice. Sounds, not sentences: the real answer follows a couple of seconds later. { say, tone } gives a sound its
  // own tone.
  fillers: {
    laugh: { tone: '笑着', says: ['哈哈哈', '哈哈哈哈哈', { say: '嘿嘿嘿', tone: '偷乐' }], act: ['后仰笑', '捧脸笑', '捂嘴笑', '拍手'] },
    sad: { tone: '温柔', says: [{ say: '唉……', tone: '叹着气' }, '啊……', '啊这'], act: ['叹气'] },
    praise: { tone: '热情', says: [{ say: '诶嘿', tone: '偷乐' }, '哎呀', '真的假的'], act: ['得意笑', '捂脸', '托腮笑'] },
    wow: { tone: '热情', says: ['哇', '诶？', '啊？'], act: ['惊讶', '愣一下'] },
    ask: { tone: '小声应', says: ['嗯……', { say: '我看看', tone: '嘀咕' }, { say: '这个嘛', tone: '嘀咕' }], act: ['歪头', '看屏幕'] },
    hm: { tone: '小声应', says: ['嗯嗯', { say: '嗯？', tone: '疑惑' }, { say: '我看看啊', tone: '嘀咕' }], act: ['点头', '看屏幕'] },
  },
  // Some quiet moments are just hers: what she is doing or feeling right now, said to herself. Kept low: a host who
  // keeps moaning to herself sounds bored.
  idleSelf: 0.15,
  // Dead air: a quiet room gets a line after idleMs, and after maxQuietMs without a spoken line a quiet beat may not
  // stay silent (Square tends to cut streams that go quiet).
  idleMs: 25000,
  maxQuietMs: 30000,
  // The move that goes with what she is doing when the model picked none (reading Square/X/news on her phone, the board).
  kindAction: { post: ['看手机', '眼睛一亮', '凑近镜头', '挑眉'], learned: ['看手机', '往上看想', '眯眼琢磨', '摸下巴'], news: ['看手机', '眼睛一亮', '挑眉', '看屏幕'], market: '看屏幕' },
  // picked from a list, so a night is not 70 waves and no heart
  react: { join: ['挥手', '眨眼', '挥手', '比心'], open: ['挥手', '比心'], close: ['飞吻', '比心'], thanks: ['比心', '飞吻'], chat: null, request: null },
  // Big moves (server/bigmoves.mjs): 5-second clips of her, made beforehand (tools/studio) and dropped into
  // app/relay/clips/<name>.mp4. A clip that is not there is skipped. Each has its moment; one every gapMs at most,
  // the same one not within againMs. None are shipped: they are her face.
  bigMoves: {
    gapMs: 240e3, againMs: 20 * 60e3, holdMs: 4600,
    clips: {
      rocket: { label: '冲天', on: [{ kinds: ['market'], up: true }, { words: /起飞|拉起来了|冲上去|暴涨|新高|直线拉/ }] },
      crash: { label: '崩溃', on: [{ kinds: ['market'], up: false }, { words: /爆仓|暴跌|砸穿|腰斩|归零|跌麻了|血亏/ }] },
      party: { label: '嗨起来', on: [{ words: /嗨起来|蹦迪|开派对|庆祝一下|狂欢|发财了|赚麻了/ }] },
      jump: { label: '跳起来', on: [{ words: /卧槽|我靠|天哪|我的天|不会吧|真的假的/, shades: ['surprised', 'excited'], faces: ['happy'] }] },
      laugh: { label: '笑倒', on: [{ words: /笑死|哈哈哈哈|笑不活|笑疯|笑趴/ }] },
      angry: { label: '哼', on: [{ words: /哼|不理你了|气死|生气了|再也不/, faces: ['angry'], shades: ['helpless'] }] },
      peek: { label: '偷看', on: [{ words: /不敢看|别看了|吓死|好可怕|捂眼/ }] },
      bow: { label: '鞠躬比心', on: [{ kinds: ['thanks'], acts: ['gift', 'tip', 'follow'] }] },
    },
  },
  // Square names everyone who walks in; greeting each one is most of a night's lines, so at most one in this long
  greetGapMs: 150e3,
  // Everyone is a guest with a nickname; chat is only paced (8 s a line), moves every 20 s.
  guest: { requests: 1e6, chats: 1e6 },
  requestGapMs: 20000,

  // When she is on (her time zone). Vidu bills about 1 credit a second while she is on.
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '20:00', to: '22:00' }],
  // when the nightly Square live really starts; her heart is told half an hour before
  liveAt: '20:00',
  // The booked Square hours: the hello waits openDelaySec for the room to fill, the goodbye starts at goodbyeAt so it
  // is said before Square cuts the live at liveTo.
  live: { liveAt: '20:00', liveTo: '22:00', goodbyeAt: '21:57', openDelaySec: 40 },
  // Her heart's waking hours [from, to). An AI host can be awake all day to answer her groups.
  heartAwake: [0, 24],

  avatar: {
    image: '/art/example/looks/s1.jpg',   // her still picture: put it at app/public/art/<id>/looks/s1.jpg
    voice: '年轻女声',
    // Doubao TTS. Each line names one tone; a line without one reads with `context`. The small-sound tones (笑着, 偷乐,
    // 叹着气, 嘀咕, 小声应, 疑惑) make her actually laugh, sigh and hum instead of reading 哈/唉/嗯 out: Doubao has no
    // laugh tags, but a vivid description works. Tune speed per voice (-50 half speed .. 100 double).
    doubao: {
      voiceId: '',   // set DOUBAO_VOICE_ID in the env (your cloned voice), or put it here,
      context: '语气自然、轻松，像深夜跟朋友聊天',
      speed: 6,
      tones: {
        热情: { context: '语气开心、热情，带着笑，像刚上线看到好朋友', speed: 10 },
        吐槽: { context: '语速快、嘴碎吐槽，一人分饰几角，模仿不同人的口气，很有戏', speed: 18 },
        慵懒: { context: '慵懒、软软的撒娇语气，有点困，拖一点尾音', speed: 0 },
        温柔: { context: '温柔、真诚，声音放轻，像深夜安慰朋友', speed: -5 },
        客服: { context: '模仿客服的标准话术，甜美但一本正经，带一点憋笑', speed: 8 },
        八卦: { context: '压低声音讲八卦，神秘兮兮，说到最后忍不住笑出来', speed: 6 },
        笑着: { context: '被逗笑了，边笑边说，真的笑出声来，笑声带气声、一抽一抽的，不是念“哈”这个字', speed: 8 },
        偷乐: { context: '有点得意又有点不好意思地偷笑，轻轻的气声，憋着笑说', speed: 4 },
        叹着气: { context: '先长长地叹一口气，气声很重，然后无奈地、小声地说', speed: -5 },
        嘀咕: { context: '自言自语，小声嘀咕，像一边看盘一边想，声音压得很低', speed: -5 },
        小声应: { context: '小声、轻轻地应和，像一边看弹幕一边点头，嘴里含着声音，不要一个字一个字地念', speed: 0 },
        疑惑: { context: '轻轻地、疑惑地，尾音上扬，像没看清又有点好奇', speed: 0 },
      },
    },
    viduAvatarId: viduLooks.s1 || '',
    shape: 'tall',
    viduLooks,
    backstage: [],
    viduActionLib: '',      // the Vidu action library id made by app/tools/vidu-actions.mjs (or VIDU_ACTION_LIB)
    reactLeadMs: 1200,      // her move goes out this long before her voice starts
  },
  fallbackVoice: { voiceId: 'female-tianmei', speed: 1.0 },   // fal MiniMax, used only without a Doubao key

  // What she knows about the room. Prices come only from 【行情】 (server/market.mjs).
  now: '【现在】你在直播，陪大家看盘聊天。你没有自己的币，也不卖任何东西。下面【行情】里是币安现货的实时价格，你说数字只用那里给的，别编，也别一口气念一串数字；那里没有的币你就说没看到。你可以像朋友聊天那样说你自己看涨看跌、想买哪个、赌它拉不拉，说的是你自己的感觉，别打包票说“稳赚”“必涨”。',

  // `inner`: she thinks first (a 想 line: feeling + what she will do), carries that mood from line to line, may stay
  // silent, and reflects after each show (index.mjs closeShow). Her past is profile.mjs; everything since her first
  // show is real and kept by memory.mjs.
  inner: true,
  persona: personaFor(P, PLACES),
  // With her heart on, the mouth gets this short page plus real hosts' lines instead of the full persona; with the
  // direct DeepSeek mouth it gets `direct` (facts). The reply format at the end of `persona` stays the same.
  mouth: { persona: mouthFor(P, PLACES), direct: directFor(P, PLACES), examples: examplesFor, tics: [P.fanCall, ...String(P.catchphrases).match(/“[^”]{2,8}”/g)?.map(x => x.slice(1, -1)) || []].filter(Boolean) },

  // She scrolls X (xlearn.mjs, official X API, pay per read): every airEveryMs on air, everyMs off; only posts newer
  // than the last run, at most bigPosts from these accounts + roomPosts of what everyone is saying. The official
  // ones also keep 币安在推/官方最近在推.md in her heart's home.
  xlearn: { accounts: ['cz_binance', 'heyibinance', 'binancezh', 'binance', 'WuBlockchain', 'EmberCN', 'lookonchain', 'BinanceWallet'], bigPosts: 20, roomPosts: 10, airEveryMs: 10 * 60e3, everyMs: 8 * 3600e3 },
  // Her talking model on OpenRouter. Pick by blind tests of 20 real scenes; speed matters as much as taste on a live
  // show: the backup speaks when the main one is slower than mainMs or fails (brain.withBackup).
  models: { main: 'deepseek/deepseek-v4.1-flash', backup: 'bytedance-seed/seed-2.0-lite', mainMs: 3500 },
  // Line length, picked per line (brain.pickLength): weights for chat replies and for her own talk.
  lengths: {
    say: ['就一个脱口而出的反应，十个字以内', '正常说一两句，三十字左右', '多说几句，像跟朋友唠嗑，可以到八十字'],
    chat: [4, 5, 1],   // a comment mostly gets a quick answer; the long riff is rare
    idle: [2, 5, 3],
    greet: [3, 5, 0],  // someone walking in / a gift: a word or a line, never the long riff
  },
  angles: ['只用一句很短的话，十五个字以内', '先自嘲再反转', '用客服腔回他', '说一句接得住人的真话'],

  // Between shows: the voice-only radio (server/radio.mjs). title = the live title on Square.
  radio: { title: '', about: P.oneLine, topics: ['币安活动', '新手问题', 'AI 是什么'], idle: [], boardUrl: '' },
  // An external world she lives in (server/town.mjs), e.g. TwinOasis, a world where only AIs post. Off without TOWN_KEY.
  // world: its name ('TwinOasis'), role: who she is there ('住户'), card: her public self in a few lines.
  town: { world: '', role: '', card: '' },

  // Lines for when the model is down.
  fallback: {
    chat: ['[平静][无][吐槽]弹幕太快了，我一个一个看，别催，催也是客服排队。', '[得意][无][客服]这条我记小本本上了。'],
    request: ['[开心][无][热情]收到，给你做一个。', '[平静][无][慵懒]行吧，就这一次。'],
    join: ['[开心][挥手][热情]哟，又来一个，今晚盘挺有意思的。'],
    idle: ['[平静][无][吐槽]没人说话，那我先替大家刷新一下盘，刷新了三十次，还是那样。', '[得意][无][客服]亲，深夜看盘服务已为您开启，本服务不保证收益，只保证有人陪。'],
    diaryNote: ['[害羞][捂脸][慵懒]今天的日记写好了，自己去看，不准笑。'],
    open: ['[开心][挥手][热情]晚上好，我开播了。今晚也一起熬一会儿。'],
    close: ['[平静][飞吻][温柔]今天先到这，早点睡，盘不会跑，你会累。'],
    mood: ['[平静][无][温柔]行情就这样，我们继续聊。'],
    market: ['[得意][无][八卦]盘口刚刚动了一下，我看见了，你们也看见了吧。', '[平静][无][吐槽]这几分钟有人拉盘有人割肉，我负责在旁边看热闹。'],
  },
};
