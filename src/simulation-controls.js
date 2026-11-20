import { scheduleStops, serviceTime } from './simulation.js';
import { createTrainDiagram } from './train-diagram.js';
import './train-diagram.css';

export function simulationControls({ timetable, stations, getDirection, getReferenceDate, hasReference, onStart,
  onReference, onClearReference, onRestore, button = document.createElement('button'), getSelection, followStatus, onFollow }) {
  button.type = 'button';
  if (!button.isConnected) {
    button.id = 'simulation-button'; button.className = 'secondary-button';
    button.textContent = 'ダイヤ・区間を選ぶ';
    document.getElementById('api-button').after(button);
  }
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'simulation-dialog');
  const dialog = document.createElement('dialog');
  dialog.id = 'simulation-dialog'; dialog.setAttribute('aria-labelledby', 'simulation-title');
  dialog.innerHTML = `<form id="simulation-form">
    <div class="dialog-header"><h2 id="simulation-title">ダイヤ・区間を選ぶ</h2><button type="button" class="icon-button" id="simulation-close" aria-label="閉じる">×</button></div>
    <div class="simulation-fields">
      <label>運行日<select id="simulation-day"><option value="weekday">平日</option><option value="holiday">土曜・休日</option></select></label>
      <label>方面<select id="simulation-direction"><option value="front">下り · 樽見方面</option><option value="back">上り · 大垣方面</option></select></label>
    </div>
    <figure class="train-diagram"><figcaption>列車ダイヤグラム</figcaption><div><svg id="simulation-diagram" role="img" aria-label="時刻と駅を結ぶ列車線。下の列車欄からも選べます"></svg></div></figure>
    <div class="simulation-fields">
      <label class="train-field">列車<select id="simulation-departure"></select></label>
      <label>乗車駅<select id="simulation-station"></select></label>
      <label>降車駅<select id="simulation-end-station"></select></label>
    </div>
    <div id="simulation-preview" class="simulation-preview"><div class="simulation-summary"><strong id="simulation-route"></strong><span id="simulation-duration"></span></div>
      <p id="simulation-note" hidden></p><div id="simulation-stops-preview" class="simulation-stops-scroll" hidden><table><thead><tr><th>駅</th><th>到着</th><th>発車</th></tr></thead><tbody id="simulation-stops"></tbody></table></div>
    </div>
    <a class="simulation-source" href="${timetable.sourceURL}" target="_blank" rel="noopener">公式時刻表 ↗</a>
    ${onReference ? `<label class="simulation-reference-toggle"><input id="simulation-reference" type="checkbox" />GPS記録にダイヤを表示</label>
      <label id="simulation-reference-date-field" class="simulation-reference-date" hidden>照合日<input id="simulation-reference-date" type="date" /></label>` : ''}
    <p id="simulation-follow-status" class="field-note" hidden></p><p id="simulation-error" role="alert" hidden></p>
    <div class="dialog-actions">
      ${onRestore ? '<button type="button" id="simulation-clear-reference" class="secondary-button" hidden>照合を解除</button><button type="button" id="simulation-restore" class="secondary-button" disabled>GPS記録に戻る</button>' : ''}
      ${onFollow ? '<button type="button" id="simulation-follow" class="secondary-button">現在時刻で追従</button>' : ''}
      <button type="submit" id="simulation-start" class="primary-button">この区間を再生</button>
    </div></form>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector(`#simulation-${id}`);
  const names = new Map(stations.map(station => [station.order, station.name]));
  let trains = [], diagrams, plan, applied;
  const draw = createTrainDiagram($('diagram'), stations, id => {
    $('departure').value = id;
    refreshStops();
  });
  function selection() {
    return { trainId: $('departure').value, stationOrder: Number($('station').value),
      endStationOrder: Number($('end-station').value), day: $('day').value, date: $('reference-date')?.value };
  }
  function refreshFollow() {
    if (!onFollow || !plan) return;
    const status = followStatus(selection(), plan);
    $('follow').disabled = !status.available;
    $('follow').textContent = status.waiting ? 'この区間の発車を待つ' : (status.label ?? '現在時刻で追従');
    $('follow-status').textContent = status.message;
    $('follow-status').hidden = !status.message;
  }
  function preview() {
    $('error').hidden = true;
    const choice = selection();
    plan = scheduleStops(timetable, choice.trainId, choice.stationOrder, choice.day, choice.endStationOrder);
    const first = plan.stops[0], last = plan.stops.at(-1);
    const arrival = serviceTime(plan.end, last.estimatedArrival);
    $('route').textContent = `${names.get(first.station)} → ${names.get(last.station)}`;
    $('duration').textContent = `${serviceTime(plan.start)} 発 → ${arrival} 着${last.estimatedArrival ? '（推定）' : ''} · ${Math.round((plan.end - plan.start) / 60)}分`;
    const showTransfer = !plan.train.transferStation || plan.stops.some(stop => stop.station === plan.train.transferStation);
    const note = showTransfer ? plan.train.note : '';
    $('note').textContent = note || ''; $('note').hidden = !note;
    $('stops').replaceChildren(...plan.stops.map((stop, index) => {
      const row = document.createElement('tr');
      const values = [names.get(stop.station), index === 0 ? '—' : serviceTime(stop.arrivalSeconds, stop.estimatedArrival) + (stop.estimatedArrival ? '（推定）' : ''),
        stop === last ? '—' : stop.departure];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      return row;
    }));
    draw(diagrams, plan);
    refreshFollow();
  }
  function stationOptions(stops) {
    return stops.map(stop => new Option(`TR${String(stop.station).padStart(2, '0')} ${names.get(stop.station)}`, String(stop.station)));
  }
  function refreshEnd(endStationOrder) {
    const train = trains.find(train => train.id === $('departure').value);
    const index = train.stops.findIndex(stop => stop.station === Number($('station').value));
    const ends = train.stops.slice(index + 1);
    $('end-station').replaceChildren(...stationOptions(ends));
    $('end-station').value = String(ends.some(stop => stop.station === endStationOrder) ? endStationOrder : ends.at(-1).station);
    preview();
  }
  function refreshStops(from, to) {
    const train = trains.find(train => train.id === $('departure').value);
    const starts = train.stops.slice(0, -1).filter(stop => stop.departure);
    $('station').replaceChildren(...stationOptions(starts));
    if (starts.some(stop => stop.station === from)) $('station').value = String(from);
    refreshEnd(to);
  }
  function refreshTrains(choice = {}) {
    trains = timetable.trains.filter(train => train.direction === $('direction').value &&
      (train.operatingDays === 'daily' || $('day').value === 'holiday'))
      .sort((a, b) => a.stops[0].departure.localeCompare(b.stops[0].departure));
    diagrams = trains.map(train => scheduleStops(timetable, train.id, train.stops[0].station, $('day').value));
    $('departure').replaceChildren(...trains.map(train => {
      const first = train.stops[0];
      return new Option(`${first.departure} ${names.get(first.station)}発 · ${train.id}列車 · ${names.get(train.stops.at(-1).station)}行`, train.id);
    }));
    if (trains.some(train => train.id === choice.trainId)) $('departure').value = choice.trainId;
    refreshStops(choice.stationOrder, choice.endStationOrder);
  }
  function setReference(enabled) {
    if (!onReference) return;
    $('reference').checked = enabled;
    $('reference-date-field').hidden = !enabled; $('reference-date').required = enabled;
    $('stops-preview').hidden = !enabled;
    $('start').textContent = enabled ? '記録と照合する' : 'この区間を再生';
  }
  function open(direction, choice = getSelection?.() ?? applied) {
    $('day').value = choice?.day ?? 'weekday';
    const train = timetable.trains.find(train => train.id === choice?.trainId);
    $('direction').value = direction ?? train?.direction ?? getDirection();
    if (onReference) {
      $('reference-date').value = getReferenceDate();
      $('clear-reference').hidden = !hasReference();
      setReference(false);
    }
    refreshTrains(choice);
    dialog.showModal();
  }
  function start(choice) {
    onStart(choice);
    applied = choice;
    if (onRestore) $('restore').disabled = false;
  }
  $('direction').addEventListener('change', () => refreshTrains());
  $('day').addEventListener('change', () => refreshTrains(selection()));
  $('departure').addEventListener('change', () => refreshStops());
  $('station').addEventListener('change', () => refreshEnd(Number($('end-station').value)));
  $('end-station').addEventListener('change', preview);
  $('reference')?.addEventListener('change', () => setReference($('reference').checked));
  $('clear-reference')?.addEventListener('click', () => { onClearReference(); dialog.close(); });
  $('restore')?.addEventListener('click', () => { onRestore(); applied = null; $('restore').disabled = true; dialog.close(); });
  $('close').addEventListener('click', () => dialog.close());
  button.addEventListener('click', () => open());
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const chosen = selection();
      if ($('reference')?.checked) {
        onReference(chosen); applied = chosen; $('restore').disabled = true;
      } else start(chosen);
      dialog.close();
    } catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
  });
  $('follow')?.addEventListener('click', () => {
    refreshFollow();
    if ($('follow').disabled) return;
    const choice = selection();
    onFollow(choice, plan);
    applied = choice;
    dialog.close();
  });
  return { open, start, refreshFollow() { if (dialog.open) refreshFollow(); } };
}
