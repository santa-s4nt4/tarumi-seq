import { japanDate, serviceDayAt, serviceDayEpoch } from './timetable-reference.js';

// ?debug=weekday|holiday&time=HH:MM[:SS] starts LIVE at that Japan time on the
// nearest matching service day; the clock then keeps running in real time.
export function debugClock(params, realNow = Date.now) {
  const day = params.get('debug'), match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(params.get('time') ?? '');
  if (!['weekday', 'holiday'].includes(day) || !match) return realNow;
  const started = realNow();
  let epoch = serviceDayEpoch(japanDate(started));
  while (serviceDayAt(epoch) !== day) epoch += 86400000;
  const offset = epoch + (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)) * 1000 - started;
  return () => realNow() + offset;
}
