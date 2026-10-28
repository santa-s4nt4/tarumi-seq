import { departures, scheduleStops, serviceTime } from './simulation.js';

export function simulationControls({ timetable, stations, getDirection, getReferenceDate, hasReference, onStart, onReference, onClearReference, onRestore }) {
  const button = document.createElement('button');
  button.id = 'simulation-button'; button.className = 'secondary-button';
  button.innerHTML = '<span class="simulation-button-long">ダイヤで再生</span><span class="simulation-button-short">ダイヤ</span>';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'simulation-dialog');
  document.getElementById('api-button').after(button);
  const dialog = document.createElement('dialog'); dialog.id = 'simulation-dialog'; dialog.setAttribute('aria-labelledby', 'simulation-title');
  dialog.innerHTML = `<form id="simulation-form"><div class="dialog-header"><div><span class="eyebrow">TIMETABLE SIMULATION</span><h2 id="simulation-title">ダイヤで再生</h2></div><button type="button" class="icon-button" id="simulation-close" aria-label="閉じる">×</button></div>
    <p class="field-note">本巣〜樽見の区間を再生します。</p>
    <div class="simulation-fields"><label>方面<select id="simulation-direction"><option value="front">下り · 樽見方面</option><option value="back">上り · 本巣方面</option></select></label>
    <label>運行日<select id="simulation-day"><option value="weekday">平日</option><option value="holiday">土曜・休日</option></select></label>
    <label>出発駅<select id="simulation-station">${stations.map(station => `<option value="${station.order}">TR${String(station.order).padStart(2, '0')} ${station.name}</option>`).join('')}</select></label>
    <label>発車時刻・列車<select id="simulation-departure"></select></label></div>
    <p id="simulation-empty" role="status" hidden>この条件で発車する列車はありません。</p>
    <div id="simulation-preview" class="simulation-preview"><div class="simulation-summary"><strong id="simulation-route"></strong><span id="simulation-duration"></span></div><p id="simulation-note" hidden></p>
    <div id="simulation-stops-preview" class="simulation-stops-scroll" hidden><table><thead><tr><th>駅</th><th>到着</th><th>発車</th></tr></thead><tbody id="simulation-stops"></tbody></table></div></div>
    <p class="field-note simulation-explanation">2024年4月8日改正ダイヤ。発車時刻と本巣・終点の到着時刻は時刻表に一致します。* は推定の到着時刻です。走行速度も推定です。</p>
    <a class="simulation-source" href="${timetable.sourceURL}" target="_blank" rel="noopener">公式時刻表を見る ↗</a><p id="simulation-error" role="alert" hidden></p>
    <label class="simulation-reference-toggle"><input id="simulation-reference" type="checkbox" />GPS記録にダイヤを表示</label>
    <label id="simulation-reference-date-field" class="simulation-reference-date" hidden>照合日<input id="simulation-reference-date" type="date" /></label>
    <div class="dialog-actions"><button type="button" id="simulation-clear-reference" class="secondary-button" hidden>照合を解除</button><button type="button" id="simulation-restore" class="secondary-button" disabled>GPS記録に戻る</button><button type="submit" id="simulation-start" class="primary-button">この列車で再生</button></div></form>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector(`#simulation-${id}`);
  let active = false;
  function selection() { return { trainId: $('departure').value, stationOrder: Number($('station').value), day: $('day').value, date: $('reference-date').value }; }
  function preview() {
    $('error').hidden = true;
    const available = Boolean($('departure').value);
    $('empty').hidden = available; $('preview').hidden = !available; $('start').disabled = !available;
    if (!available) return;
    const plan = scheduleStops(timetable, $('departure').value, Number($('station').value), $('day').value);
    const name = order => stations.find(station => station.order === order).name;
    $('route').textContent = `${name(plan.stops[0].station)} → ${name(plan.stops.at(-1).station)}`;
    $('duration').textContent = `${plan.train.id}列車 · ${Math.round((plan.end - plan.start) / 60)}分`;
    const note = plan.train.transferStation && !plan.stops.some(stop => stop.station === plan.train.transferStation) ? '' : plan.train.note ?? '';
    $('note').textContent = note; $('note').hidden = !note;
    $('stops').replaceChildren(...plan.stops.map((stop, index) => {
      const row = document.createElement('tr');
      const values = [name(stop.station), index === 0 ? '—' : `${serviceTime(stop.arrivalSeconds, stop.estimatedArrival)}${stop.estimatedArrival ? ' *' : ''}`, stop.departure ?? '—'];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      if (stop.estimatedArrival) row.className = 'estimated-arrival';
      return row;
    }));
  }
  function refresh() {
    const direction = $('direction').value, day = $('day').value;
    for (const option of $('station').options) option.disabled = !departures(timetable, direction, day, Number(option.value)).length;
    if ($('station').selectedOptions[0].disabled) $('station').value = String(direction === 'front' ? timetable.section.firstStation : timetable.section.lastStation);
    const previous = $('departure').value, entries = departures(timetable, direction, day, Number($('station').value));
    $('departure').replaceChildren(...entries.map(({ train, time }) => {
      const option = document.createElement('option'); option.value = train.id;
      const endpoint = train.stops.at(-1);
      option.textContent = `${time} · ${train.id}列車 · ${stations.find(s => s.order === endpoint.station).name}行き${train.operatingDays === 'holiday' ? '（土曜・休日）' : ''}`;
      return option;
    }));
    if (entries.some(entry => entry.train.id === previous)) $('departure').value = previous;
    preview();
  }
  for (const name of ['direction', 'day', 'station']) $(name).addEventListener('change', refresh);
  $('departure').addEventListener('change', preview);
  $('reference').addEventListener('change', () => {
    const enabled = $('reference').checked;
    $('reference-date-field').hidden = !enabled;
    $('reference-date').required = enabled;
    $('stops-preview').hidden = !enabled;
    $('start').textContent = enabled ? '記録と照合する' : 'この列車で再生';
  });
  $('clear-reference').addEventListener('click', () => { onClearReference(); $('clear-reference').hidden = true; $('reference').checked = false; $('reference').dispatchEvent(new Event('change')); dialog.close(); });
  $('close').addEventListener('click', () => dialog.close());
  button.addEventListener('click', () => {
    if (!active) $('direction').value = getDirection();
    $('reference-date').value = getReferenceDate();
    $('clear-reference').hidden = !hasReference();
    refresh(); dialog.showModal();
  });
  $('form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const chosen = selection();
      if ($('reference').checked) {
        onReference(chosen); active = false; $('restore').disabled = true;
      } else {
        onStart(chosen); active = true; $('restore').disabled = false;
      }
      dialog.close();
    }
    catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
  });
  $('restore').addEventListener('click', () => { onRestore(); active = false; $('restore').disabled = true; dialog.close(); });
  return { open(direction) { $('direction').value = direction; $('reference').checked = false; $('reference').dispatchEvent(new Event('change')); $('reference-date').value = getReferenceDate(); $('clear-reference').hidden = !hasReference(); refresh(); dialog.showModal(); } };
}
