// <data>/air.json {"until": ms} puts her on air right now, outside the schedule, until that time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('server: air.json opens an extra show now and ends it on time', async () => {
  const { start } = await import('../server/index.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-air-'));
  const app = await start({ IDOL: 'example', DATA_DIR: dir, MODEL_OFF: '1', VOICE_OFF: '1', ON_AIR: '', NEWS_OFF: '1', MARKET_OFF: '1' });
  try {
    const now = Date.now(), regular = app.schedule.info(now);
    fs.writeFileSync(path.join(dir, 'air.json'), JSON.stringify({ until: now + 60 * 60e3 }));
    await new Promise(r => setTimeout(r, 10500));   // the file is re-read every 10 s
    assert.equal(app.schedule.onAir(), true);
    assert.ok(app.schedule.info().endsAt >= now + 60 * 60e3);
    if (!regular.onAir) assert.ok(app.schedule.info().endsAt <= Math.max(now + 60 * 60e3, regular.nextAt + 3 * 3600e3));
  } finally { await app.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); }
});
