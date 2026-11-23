import test from 'node:test';
import assert from 'node:assert/strict';
import { debugClock } from '../src/debug-clock.js';
import { japanDate, serviceDayAt, serviceDayEpoch } from '../src/timetable-reference.js';

const clockAt = (query, start) => { let real = Date.parse(start); const clock = debugClock(new URLSearchParams(query), () => real); return { clock, advance(ms) { real += ms; } }; };
const seconds = now => (now - serviceDayEpoch(japanDate(now))) / 1000;

test('debug clock starts at the requested time on a matching service day and keeps running', () => {
  // 2026-11-23 is a Monday and a national holiday.
  for (const [day, date] of [['holiday', '2026-11-23'], ['weekday', '2026-11-24']]) {
    const { clock, advance } = clockAt(`debug=${day}&time=12:49`, '2026-11-23T20:15:30+09:00');
    assert.equal(serviceDayAt(clock()), day);
    assert.equal(japanDate(clock()), date);
    assert.equal(seconds(clock()), 12 * 3600 + 49 * 60);
    advance(2500);
    assert.equal(seconds(clock()), 12 * 3600 + 49 * 60 + 2.5);
  }
  assert.equal(seconds(clockAt('debug=weekday&time=7:05:09', '2026-11-21T10:00:00+09:00').clock()), 7 * 3600 + 5 * 60 + 9);
});

test('debug clock is the real clock without a valid day and time', () => {
  for (const query of ['', 'debug=holiday', 'time=12:49', 'debug=1&time=12:49', 'debug=weekday&time=noon']) {
    const { clock } = clockAt(query, '2026-11-23T20:15:30+09:00');
    assert.equal(clock(), Date.parse('2026-11-23T20:15:30+09:00'));
  }
});
