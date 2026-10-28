import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../server/world.mjs';
import { createBrain, promptFor } from '../server/brain.mjs';
import idol from '../idols/example/config.mjs';

// Free entry: a guest asks for one move and says one line.

test('a 点播 is always performed, whatever action the model wrote, and names the guest as a guest', async () => {
  const world = createWorld({ idol });
  const spoken = [];
  const brain = createBrain({ idol, world, ask: async () => ({ text: '[开心][飞吻]好喔，挥给你看～', cost: 0 }), speak: async l => { spoken.push(l); }, viewers: () => 0 });
  const e = { kind: 'request', addr: 'guest-0123456789', action: '挥手', tier: 'guest', tierName: '游客' };
  brain.add(e);
  brain.start();
  await new Promise(r => setTimeout(r, 50));
  brain.stop();
  assert.equal(spoken[0].action, '挥手');
  const p = promptFor(idol, e, world.w).text;
  assert.match(p, /游客6789/);
  assert.match(p, /\[挥手\]/);
});

test('a guest with a nickname is named by it', () => {
  const p = promptFor(idol, { kind: 'request', addr: 'guest-0123456789', name: '小A', action: '比心' }).text;
  assert.match(p, /小A 点你做「比心」/);
});
