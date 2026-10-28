import './timetable-reference.css';
import { TimetableReference, japanDate, differenceLabel } from './timetable-reference.js';

// Timetable comparisons live inside the GPS cue cards. The selection itself is
// made by the timetable playback dialog or automatically from live direction
// and Japan time; there is no second reference dialog.
export function timetableReferenceDisplay({ timetable, railway, stations, getClock, getDirection }) {
  const reference = new TimetableReference(timetable, railway, stations);

  function renderNote(parent, event, className) {
    const comparison = reference.comparison(event, getClock(), getDirection());
    let note = parent.querySelector(`.${className}`);
    if (!comparison) { note?.remove(); return; }
    if (!note) {
      note = document.createElement('p'); note.className = className;
      if (className === 'countdown-schedule') parent.querySelector('#countdown-target').after(note);
      else parent.append(note);
    }
    const value = `${comparison.label}${comparison.departure ? ` · 発 ${comparison.departure}` : ''}\n${event.arrived ? '差 —（駅付近・停車中）' : differenceLabel(comparison.deltaSeconds)}`;
    if (note.textContent !== value) note.textContent = value;
    note.title = comparison.estimated ? '推定の予定時刻。駅到着は発車30秒前、トンネルは駅間の推定走行を使用。差は到着見込みとの比較です。' : 'ダイヤ上の到着予定。差は到着見込みとの比較です。';
  }

  return {
    reference,
    syncTrain(trainId, day, date = japanDate(getClock())) { reference.connect({ trainId, day, date }); },
    syncDate() {
      if (reference.plan) reference.connect({ trainId: reference.plan.train.id, day: reference.day, date: japanDate(getClock()) });
    },
    autoSelect() { return reference.autoSelect({ now: getClock(), direction: getDirection() }); },
    renderCard(card, event) { renderNote(card, event, 'cue-schedule'); },
    renderFocus(event) { renderNote(document.querySelector('.countdown-focus'), event, 'countdown-schedule'); },
  };
}
