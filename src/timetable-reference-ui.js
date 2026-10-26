import './timetable-reference.css';
import { TimetableReference, japanDate, differenceLabel } from './timetable-reference.js';
import { serviceTime } from './simulation.js';

export function timetableReferenceControls({ timetable, railway, stations, host, getClock, getDirection, onChange }) {
  const reference = new TimetableReference(timetable, railway, stations);
  document.body.classList.add('has-timetable-reference');
  const row = document.createElement('div'); row.className = 'timetable-reference';
  row.innerHTML = '<button id="reference-button" class="secondary-button" aria-haspopup="dialog" aria-controls="reference-dialog">ダイヤ参照</button><span id="reference-summary">未接続 · 到着予定を小さく併記できます</span>';
  host.prepend(row);
  const dialog = document.createElement('dialog'); dialog.id = 'reference-dialog'; dialog.setAttribute('aria-labelledby', 'reference-title');
  dialog.innerHTML = `<form id="reference-form"><div class="dialog-header"><div><span class="eyebrow">TIMETABLE REFERENCE</span><h2 id="reference-title">到着時刻の参照ダイヤ</h2></div><button type="button" class="icon-button" id="reference-close" aria-label="閉じる">×</button></div>
    <p class="field-note">列車の予定到着時刻を合図に併記します。</p>
    <div class="simulation-fields"><label>参照日（日本時間）<input id="reference-date" type="date" required /></label><label>運行日<select id="reference-day"><option value="weekday">平日</option><option value="holiday">土曜・休日</option></select></label><label class="reference-train-field">列車<select id="reference-train" required></select></label></div>
    <p id="reference-direction" class="field-note"></p><p id="reference-note" class="field-note"></p>
    <details class="reference-details"><summary>各駅の予定時刻を見る</summary><div class="simulation-stops-scroll"><table class="reference-stops"><thead><tr><th>駅</th><th>到着</th><th>発車</th></tr></thead><tbody id="reference-stops"></tbody></table></div></details>
    <p class="field-note">2024年4月8日改正。* は発車30秒前とした推定到着、または駅間走行から求めた推定通過時刻です。差は到着見込みとの比較で、確定した遅延ではありません。</p>
    <a class="simulation-source" href="${timetable.sourceURL}" target="_blank" rel="noopener">公式時刻表を見る ↗</a><p id="reference-error" role="alert" hidden></p>
    <div class="dialog-actions"><button id="reference-disconnect" type="button" class="secondary-button">参照を解除</button><button id="reference-connect" type="submit" class="primary-button">参照する</button></div></form>`;
  document.body.append(dialog);
  const $ = name => dialog.querySelector(`#reference-${name}`);
  let preview = null;
  function selection() { return { trainId: $('train').value, day: $('day').value, date: $('date').value }; }
  function showPreview() {
    $('error').hidden = true;
    try {
      preview = new TimetableReference(timetable, railway, stations); preview.connect(selection());
      $('note').textContent = preview.plan.train.note ?? '';
      $('stops').replaceChildren(...preview.plan.stops.map((stop, index) => {
        const tr = document.createElement('tr');
        const arrival = index === 0 ? stop.arrival ?? '—' : `${serviceTime(stop.arrivalSeconds, stop.estimatedArrival)}${stop.estimatedArrival ? ' *' : ''}`;
        for (const value of [stop.name, arrival, stop.departure ?? '—']) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
        return tr;
      })); $('connect').disabled = false;
    } catch (error) { preview = null; $('stops').replaceChildren(); $('error').textContent = error.message; $('error').hidden = false; $('connect').disabled = true; }
  }
  function refresh() {
    const previous = $('train').value, direction = getDirection();
    const trains = timetable.trains.filter(train => train.direction === direction && (train.operatingDays === 'daily' || $('day').value === 'holiday'));
    $('train').replaceChildren(...trains.map(train => {
      const option = document.createElement('option'); option.value = train.id;
      const first = train.stops[0], last = train.stops.at(-1), name = order => stations.find(item => item.order === order).name;
      option.textContent = `${train.id}列車 · ${first.departure} ${name(first.station)} → ${last.arrival} ${name(last.station)}`;
      return option;
    }));
    if (trains.some(train => train.id === previous)) $('train').value = previous;
    $('direction').textContent = `${direction === 'front' ? '下り・樽見方面' : '上り・大垣方面'}（画面下部で切替）`;
    showPreview();
  }
  function updateSummary() {
    const plan = reference.plan;
    const summary = plan ? `${plan.train.id}列車 · ${reference.date} · ${getDirection() === plan.train.direction ? '参照中' : '方面が異なります'}` : '未接続 · 到着予定を小さく併記できます';
    if (row.querySelector('#reference-summary').textContent !== summary) row.querySelector('#reference-summary').textContent = summary;
    document.body.classList.toggle('timetable-reference-active', Boolean(plan && getDirection() === plan.train.direction));
  }
  function renderNote(parent, event, className) {
    const comparison = reference.comparison(event, getClock(), getDirection());
    let note = parent.querySelector(`.${className}`);
    if (!comparison) { note?.remove(); return; }
    if (!note) { note = document.createElement('p'); note.className = className; if (className === 'countdown-schedule') parent.querySelector('#countdown-target').after(note); else parent.append(note); }
    const value = `${comparison.label}${comparison.departure ? ` · 発 ${comparison.departure}` : ''}\n${event.arrived ? '差 —（駅付近・停車中）' : differenceLabel(comparison.deltaSeconds)}`;
    if (note.textContent !== value) note.textContent = value;
    note.title = comparison.estimated ? '推定の予定時刻。駅到着は発車30秒前、トンネルは駅間の推定走行を使用。差は到着見込みとの比較です。' : 'ダイヤ上の到着予定。差は到着見込みとの比較です。';
  }
  row.querySelector('button').addEventListener('click', () => {
    $('date').value = reference.date ?? japanDate(getClock()); $('day').value = reference.day ?? 'weekday';
    refresh(); if (reference.plan?.train.direction === getDirection()) { $('train').value = reference.plan.train.id; showPreview(); }
    dialog.showModal();
  });
  for (const name of ['day', 'date']) $(name).addEventListener('change', refresh);
  $('train').addEventListener('change', showPreview);
  $('close').addEventListener('click', () => dialog.close());
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    try { reference.connect(selection()); updateSummary(); dialog.close(); onChange(); }
    catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
  });
  $('disconnect').addEventListener('click', () => { reference.disconnect(); updateSummary(); dialog.close(); onChange(); });
  return {
    reference,
    syncTrain(trainId, day) { reference.connect({ trainId, day, date: japanDate(getClock()) }); updateSummary(); },
    syncDate() { if (reference.plan) { reference.connect({ trainId: reference.plan.train.id, day: reference.day, date: japanDate(getClock()) }); updateSummary(); } },
    update() { updateSummary(); },
    renderCard(card, event) { renderNote(card, event, 'cue-schedule'); },
    renderFocus(event) { renderNote(document.querySelector('.countdown-focus'), event, 'countdown-schedule'); },
  };
}
