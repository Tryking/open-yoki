// When she is on air. The idol config lists daily windows in her own time zone, e.g. 20:00–23:00 Beijing time; a
// window may run past midnight (22:00–02:00). `force` overrides the schedule: 'on' for testing, 'off' to take a break.
const DAY = 864e5;
const mins = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

// `extra()` returns an extra show's end time (ms) or null: an extra show (<data>/air.json) puts her on air right away,
// whatever the clock says, until then.
// `regular()` false = the daily windows are paused (only test runs and extra shows go on air through `extra`).
export function createSchedule({ windows, tz = 8, force = null, extra = () => null, regular = () => true }) {
  const offset = tz * 3600e3;
  // Every window occurrence [start, end) in ms that overlaps the days around t.
  function around(t) {
    if (!regular()) return [];
    const local = t + offset, day0 = Math.floor(local / DAY) * DAY;
    const out = [];
    for (let d = -1; d <= 7; d++) {
      const dayStart = day0 + d * DAY, weekday = new Date(dayStart).getUTCDay();
      for (const w of windows) {
        if (w.days && !w.days.includes(weekday)) continue;
        const a = mins(w.from), b = mins(w.to);
        const start = dayStart + a * 60e3 - offset, end = dayStart + (b > a ? b : b + 1440) * 60e3 - offset;
        out.push([start, end]);
      }
    }
    return out.sort((x, y) => x[0] - y[0]);
  }
  function current(t) {
    const until = extra();
    // A regular show that starts before the extra one ends just carries on: no goodbye and hello in between.
    if (until && t < until) return [t, Math.max(until, ...around(t).filter(([a, b]) => a <= until && b > t).map(([, b]) => b))];
    return around(t).find(([a, b]) => t >= a && t < b) || null;
  }
  function onAir(t = Date.now()) {
    if (force === 'on') return true;
    if (force === 'off') return false;
    return !!current(t);
  }
  // Next start (when off air) and the end of the current window (when on air).
  function info(t = Date.now()) {
    const cur = force === 'on' ? null : current(t);
    const next = around(t).find(([a]) => a > Math.max(t, cur?.[1] ?? t));
    return { onAir: onAir(t), forced: force, endsAt: force ? null : cur?.[1] ?? null, nextAt: force === 'on' ? null : next?.[0] ?? null };
  }
  // TEST controls only: switch the override at run time (end the show to watch the goodbye and 忘关麦).
  return { onAir, info, force(v) { force = v; } };
}

// "20:00" style text for a timestamp in the idol's zone (used in her goodbye line and the off-air screen).
export const clockIn = (t, tz = 8) => new Date(t + tz * 3600e3).toISOString().slice(11, 16);

// The nightly Square live is booked for set hours (liveAt–liveTo in her zone): Square only takes the feed from liveAt
// and cuts it at liveTo: a hello said before the room opens is lost, and a cut at liveTo leaves no goodbye. `cue` says where the clock is: 'wait' before liveAt + openDelay (hold the hello), 'end' from goodbyeAt
// to liveTo (say goodbye now), else null. Times are "HH:MM" or "HH:MM:SS".
const secs = s => { const [h, m, x = 0] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
export function showCue(t, { tz = 8, liveAt, liveTo, goodbyeAt, openDelaySec = 0 } = {}) {
  const now = Math.floor((((t + tz * 3600e3) % DAY) + DAY) % DAY / 1000);
  if (liveAt && liveTo) {
    const a = secs(liveAt), b = secs(liveTo);
    if (now < a + openDelaySec && now >= a - 3600) return 'wait';
    if (goodbyeAt && now >= secs(goodbyeAt) && now < b + 3600) return 'end';
  }
  return null;
}
