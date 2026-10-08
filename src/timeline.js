export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function sampleAt(records, t) {
  if (t <= records[0].t) return { ...records[0], interpolated: false, gap: false };
  if (t >= records.at(-1).t) return { ...records.at(-1), interpolated: false, gap: false };
  let lo = 0, hi = records.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (records[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = records[lo], b = records[hi], gap = b.t - a.t;
  if (gap > 5) return { ...a, interpolated: false, gap: true };
  const u = (t - a.t) / gap;
  return { t, lat: a.lat + (b.lat - a.lat) * u, lon: a.lon + (b.lon - a.lon) * u,
    speed: a.speed + (b.speed - a.speed) * u, interpolated: u > 0 && u < 1, gap: false };
}

export function recordedAt(recording, t) {
  // records.t is the synchronized video timeline. Convert it back to the GPS clock.
  return new Date(Date.parse(recording.meta.start_time) + (t + (recording.meta.offset || 0)) * 1000).toISOString();
}

export function timeLabel(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function advanceTime(t, delta, rate, end) {
  return { time: Math.min(end, t + Math.max(0, delta) * rate), ended: t + Math.max(0, delta) * rate >= end };
}

export function stationEvent(events, t, step) {
  const stations = events.filter(e => e.type === 'station');
  return step > 0 ? stations.find(e => e.t > t + 0.5) : stations.findLast(e => e.t < t - 0.5);
}
