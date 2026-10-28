import test from 'node:test';
import assert from 'node:assert/strict';
import { showCue } from '../server/schedule.mjs';

const live = { tz: 8, liveAt: '19:00', liveTo: '21:00', goodbyeAt: '20:57', openDelaySec: 40 };
// Beijing clock on a sample day → ms
const at = hms => Date.parse(`2026-10-24T${hms}+08:00`);

test('the hello waits for the Square room, the goodbye comes before Square cuts', () => {
  assert.equal(showCue(at('18:58:05'), live), 'wait');
  assert.equal(showCue(at('19:00:20'), live), 'wait');
  assert.equal(showCue(at('19:00:40'), live), null);
  assert.equal(showCue(at('20:30:00'), live), null);
  assert.equal(showCue(at('20:56:59'), live), null);
  assert.equal(showCue(at('20:57:00'), live), 'end');
  assert.equal(showCue(at('21:02:00'), live), 'end');
  assert.equal(showCue(at('14:00:00'), live), null);
  assert.equal(showCue(at('19:30:00'), {}), null);
});
