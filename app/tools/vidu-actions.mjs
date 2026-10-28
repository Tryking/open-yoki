// Sync the idol's actions (config `actions[*].lib`) into a Vidu action library. Creating and editing a library costs
// no credits; Vidu rewrites each description on save, so the rewritten text is printed for checking.
//   VIDU_KEY=... node tools/vidu-actions.mjs [--idol example] [--only 挥手,比心] [--force 1]
// --force re-sends descriptions of actions already in the library. Prints the library id to bind:
// VIDU_ACTION_LIB=<id> (or idol.avatar.viduActionLib).
import { arg, api } from './vidu.mjs';

const id = arg('idol', 'example');
const idol = (await import(`../idols/${id}/config.mjs`)).default;
const only = arg('only', '').split(',').filter(Boolean);

const name = `${idol.short || id} 动作`;
const libs = await api('GET', '/action-libraries?pager.page=0&pager.pagesz=20');
let lib = libs.items?.find(l => l.name === name);
if (!lib) lib = await api('POST', '/action-libraries', { name, description: `${idol.name || id}直播用的手势和表情动作（半身镜头）` });
const libId = lib.id || lib.action_library?.id;
const have = (await api('GET', `/action-libraries/${libId}/actions?pager.page=0&pager.pagesz=100`)).items || [];

for (const [act, a] of Object.entries(idol.actions || {})) {
  if (!a.lib || (only.length && !only.includes(act))) continue;
  const old = have.find(x => x.name === act);
  if (old && !arg('force')) { console.log(`kept    ${act}: ${old.description.slice(0, 160)}`); continue; }
  // Vidu's rewrite step sometimes fails ("动作改写结果不合法"); the docs say to resend the same request.
  let r;
  for (let i = 0; ; i++) {
    try {
      r = old ? await api('PATCH', `/action-libraries/${libId}/actions/${old.id}`, { description: a.lib })
              : await api('POST', `/action-libraries/${libId}/actions`, { name: act, description: a.lib });
      break;
    } catch (e) { if (i >= 3 || !/改写/.test(e.message)) throw e; console.log(`retry   ${act}: rewrite failed`); }
  }
  console.log(`${old ? 'updated' : 'added  '} ${act}: ${(r.description || r.action?.description || JSON.stringify(r)).slice(0, 160)}`);
}
console.log(`VIDU_ACTION_LIB=${libId}`);
