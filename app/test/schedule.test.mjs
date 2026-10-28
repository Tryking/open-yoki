import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchedule, clockIn } from '../server/schedule.mjs';

// 2026-10-06 is a Tuesday. Beijing time = UTC+8.
const bj = (d, hhmm) => Date.parse(`2026-10-${d}T${hhmm}:00+08:00`);

test('on air only inside the daily window, Beijing time', () => {
  const s = createSchedule({ windows: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '20:00', to: '23:00' }], tz: 8 });
  assert.equal(s.onAir(bj('06', '19:59')), false);
  assert.equal(s.onAir(bj('06', '20:00')), true);
  assert.equal(s.onAir(bj('06', '22:59')), true);
  assert.equal(s.onAir(bj('06', '23:00')), false);
  const off = s.info(bj('06', '23:30'));
  assert.equal(off.nextAt, bj('07', '20:00'));
  assert.equal(s.info(bj('06', '21:00')).endsWith, undefined);
  assert.equal(s.info(bj('06', '21:00')).endsAt, bj('06', '23:00'));
  assert.equal(clockIn(off.nextAt, 8), '20:00');
});

test('a window past midnight and weekday filters', () => {
  const s = createSchedule({ windows: [{ days: [5, 6], from: '22:00', to: '02:00' }], tz: 8 });
  assert.equal(s.onAir(bj('09', '23:00')), true, 'Friday night');
  assert.equal(s.onAir(bj('10', '01:30')), true, 'still on after midnight');
  assert.equal(s.onAir(bj('10', '02:00')), false);
  assert.equal(s.onAir(bj('06', '23:00')), false, 'Tuesday is not a show day');
  assert.equal(s.info(bj('06', '12:00')).nextAt, bj('09', '22:00'));
});

test('force overrides the schedule', () => {
  const w = [{ from: '20:00', to: '23:00' }];
  assert.equal(createSchedule({ windows: w, force: 'on' }).onAir(bj('06', '09:00')), true);
  assert.equal(createSchedule({ windows: w, force: 'off' }).onAir(bj('06', '21:00')), false);
});

test('an extra show puts her on air now, and the next show is counted after it', () => {
  let until = bj('06', '14:00');
  const s = createSchedule({ windows: [{ from: '20:00', to: '23:00' }], tz: 8, extra: () => until });
  assert.equal(s.onAir(bj('06', '12:00')), true);
  assert.equal(s.info(bj('06', '12:00')).endsAt, bj('06', '14:00'));
  assert.equal(s.onAir(bj('06', '14:00')), false);
  assert.equal(s.info(bj('06', '14:30')).nextAt, bj('06', '20:00'));
  until = bj('06', '21:00');   // runs into the evening show: she stays on to its end
  assert.equal(s.info(bj('06', '19:00')).endsAt, bj('06', '23:00'));
  until = null;
  assert.equal(s.onAir(bj('06', '12:00')), false);
});

test('regular() off pauses the daily windows: only an extra show (e.g. a test run) goes on air', () => {
  let regular = false, until = null;
  const s = createSchedule({ windows: [{ from: '20:00', to: '23:00' }], tz: 8, extra: () => until, regular: () => regular });
  assert.equal(s.onAir(bj('06', '21:00')), false, 'no daily show while regular() is off');
  assert.equal(s.info(bj('06', '12:00')).nextAt, null);
  until = bj('06', '21:30');
  assert.equal(s.onAir(bj('06', '21:00')), true, 'an extra show still goes on air');
  regular = true; until = null;
  assert.equal(s.onAir(bj('06', '21:00')), true, 'with regular() on the daily windows apply');
});
