import { activeServices, services } from './journey.js';
import { serviceTime } from './simulation.js';
import { serviceDayAt, japanDate, serviceDayEpoch } from './timetable-reference.js';

export function createModeMenu({ timetable, stations, onLive, onCustom, onOpen = () => {}, onClose = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'mode-menu'; dialog.className = 'mode-menu';
  dialog.setAttribute('aria-label', 'モードを選ぶ');
  dialog.innerHTML = `<button class="mode-close" aria-label="メニューを閉じる">×</button>
    <div class="mode-tabs" role="tablist" aria-label="モード">
      <button id="tab-live" role="tab" aria-selected="true" aria-controls="mode-live">LIVE</button>
      <button id="tab-custom" role="tab" aria-selected="false" aria-controls="mode-custom">CUSTOM</button>
    </div>
    <section id="mode-live" role="tabpanel" aria-labelledby="tab-live">
      <time id="menu-clock" aria-label="現在時刻"></time>
      <div class="live-directions"><button data-direction="back">大垣行き</button><button data-direction="front">樽見行き</button></div>
      <p id="menu-service-status" role="status"></p>
      <div id="menu-trains" hidden><p>列車を選んでください</p><div></div></div>
    </section>
    <form id="mode-custom" role="tabpanel" aria-labelledby="tab-custom" hidden>
      <fieldset><legend>運行日</legend><label><input type="radio" name="day" value="weekday" checked><span>平日</span></label><label><input type="radio" name="day" value="holiday"><span>土・休日</span></label></fieldset>
      <fieldset><legend>方面</legend><label><input type="radio" name="direction" value="front" checked><span>樽見行き</span></label><label><input type="radio" name="direction" value="back"><span>大垣行き</span></label></fieldset>
      <label class="service-select-label" for="custom-service">発車駅・ダイヤ</label><select id="custom-service" aria-label="発車駅・ダイヤ"></select>
      <p class="menu-custom-note">再生区間は駅ごとに指定できます。</p>
      <button class="mode-confirm" type="submit">OK</button>
    </form>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const name = order => stations.find(station => station.order === order)?.name ?? '';
  let currentTab = 'live', timer;
  function tab(value) {
    currentTab = value;
    for (const mode of ['live', 'custom']) {
      $(`#tab-${mode}`).setAttribute('aria-selected', String(mode === value));
      $(`#tab-${mode}`).tabIndex = mode === value ? 0 : -1;
      $(`#mode-${mode}`).hidden = mode !== value;
    }
  }
  function refreshCustom(selected) {
    const day = $('input[name="day"]:checked').value, direction = $('input[name="direction"]:checked').value;
    const options = services(timetable, direction, day);
    $('#custom-service').replaceChildren(...options.map(train => new Option(
      `${name(train.stops[0].station)}発　${train.stops[0].departure}–${train.stops.at(-1).arrival ?? train.stops.at(-1).departure}`, train.id)));
    if (options.some(train => train.id === selected)) $('#custom-service').value = selected;
    $('.mode-confirm').disabled = !options.length;
  }
  function update() {
    const now = Date.now(), active = activeServices(timetable, now);
    $('#menu-clock').textContent = serviceTime((now - serviceDayEpoch(japanDate(now))) / 1000, true);
    for (const button of dialog.querySelectorAll('[data-direction]')) button.disabled = !active.some(train => train.direction === button.dataset.direction);
    $('#menu-service-status').textContent = active.length ? '現在運行中の方面を選んでください。' : '現在はダイヤ上の運行時間外です。CUSTOMで再生できます。';
  }
  for (const mode of ['live', 'custom']) $(`#tab-${mode}`).addEventListener('click', () => tab(mode));
  $('.mode-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); tab(currentTab === 'live' ? 'custom' : 'live'); $(`#tab-${currentTab}`).focus();
  });
  for (const button of dialog.querySelectorAll('[data-direction]')) button.addEventListener('click', () => {
    const choices = activeServices(timetable, Date.now()).filter(train => train.direction === button.dataset.direction);
    if (choices.length === 1) { onLive(choices[0]); return; }
    $('#menu-trains').hidden = false;
    $('#menu-trains div').replaceChildren(...choices.map(train => {
      const item = document.createElement('button');
      item.textContent = `${train.id}列車 · ${name(train.stops[0].station)} ${train.stops[0].departure}発`;
      item.onclick = () => onLive(train); return item;
    }));
  });
  for (const input of dialog.querySelectorAll('input')) input.addEventListener('change', () => refreshCustom($('#custom-service').value));
  $('#mode-custom').addEventListener('submit', event => {
    event.preventDefault(); onCustom({ trainId: $('#custom-service').value, day: $('input[name="day"]:checked').value });
  });
  $('.mode-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { clearInterval(timer); onClose(); });
  refreshCustom();
  return { dialog, open(mode = currentTab, selection) {
    if (selection) {
      const train = timetable.trains.find(train => train.id === selection.trainId);
      $(`input[name="day"][value="${selection.day === 'holiday' ? 'holiday' : 'weekday'}"]`).checked = true;
      if (train) $(`input[name="direction"][value="${train.direction}"]`).checked = true;
      refreshCustom(selection.trainId);
    } else if (!dialog.open) {
      $(`input[name="day"][value="${serviceDayAt(Date.now())}"]`).checked = true; refreshCustom($('#custom-service').value);
    }
    tab(mode); $('#menu-trains').hidden = true; update(); onOpen();
    if (!dialog.open) dialog.showModal();
    clearInterval(timer); timer = setInterval(update, 1000);
  } };
}
