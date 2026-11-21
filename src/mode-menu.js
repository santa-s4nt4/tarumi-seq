import { activeServices, services, directionName } from './journey.js';
import { serviceTime } from './simulation.js';
import { serviceDayAt, japanDate, serviceDayEpoch } from './timetable-reference.js';
import { menuDuration } from './menu-motion.js';

export function createModeMenu({ timetable, stations, onLive, onCustom, onOpen = () => {}, onCloseStart = () => {}, onClose = () => {} }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'mode-menu'; dialog.className = 'mode-menu'; dialog.setAttribute('aria-label', 'モードを選ぶ');
  dialog.innerHTML = `<button class="mode-close" aria-label="メニューを閉じる">×</button>
    <div class="mode-tabs" role="tablist" aria-label="モード">
      <button id="tab-live" role="tab" aria-selected="true" aria-controls="mode-live">LIVE</button>
      <button id="tab-custom" role="tab" aria-selected="false" aria-controls="mode-custom">CUSTOM</button>
    </div>
    <form id="mode-live" role="tabpanel" aria-labelledby="tab-live">
      <time id="menu-clock" aria-label="現在時刻"></time><p id="menu-service-status" role="status"></p>
      <div id="menu-trains" class="service-list" role="listbox" aria-label="運行中の列車"></div>
      <button class="mode-confirm" type="submit" disabled>OK</button>
    </form>
    <form id="mode-custom" role="tabpanel" aria-labelledby="tab-custom" hidden>
      <fieldset><legend>運行日</legend><label><input type="radio" name="day" value="weekday" checked><span>平日</span></label><label><input type="radio" name="day" value="holiday"><span>土・休日</span></label></fieldset>
      <fieldset><legend>方面</legend><label><input type="radio" name="direction" value="front" checked><span>樽見行き</span></label><label><input type="radio" name="direction" value="back"><span>大垣行き</span></label></fieldset>
      <span class="service-select-label" id="custom-service-label">発車駅・ダイヤ</span>
      <div id="custom-service" class="service-list" role="listbox" aria-labelledby="custom-service-label"></div>
      <button class="mode-confirm" type="submit">OK</button>
    </form>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector), name = order => stations.find(station => station.order === order)?.name ?? '';
  const label = train => `${name(train.stops[0].station)}発　${train.stops[0].departure}–${train.stops.at(-1).arrival ?? train.stops.at(-1).departure}`;
  let currentTab = 'live', timer, closeTimer, active = false, liveId = null, customId = null, liveChoices = [], customChoices = [], liveSignature;
  function tab(value) {
    currentTab = value;
    for (const mode of ['live', 'custom']) {
      $(`#tab-${mode}`).setAttribute('aria-selected', String(mode === value)); $(`#tab-${mode}`).tabIndex = mode === value ? 0 : -1;
      $(`#mode-${mode}`).hidden = mode !== value;
    }
    requestAnimationFrame(() => $(`#mode-${value} [role=option][aria-selected=true]`)?.scrollIntoView({ block:'nearest' }));
  }
  function choose(list, id, focus = false) {
    if (list.id === 'menu-trains') liveId = id; else customId = id;
    for (const option of list.children) {
      const selected = option.dataset.train === id;
      option.setAttribute('aria-selected', String(selected)); option.tabIndex = selected ? 0 : -1;
      if (selected && focus) { option.focus({ preventScroll: true }); option.scrollIntoView({ block: 'nearest' }); }
    }
    if (!id && list.firstElementChild) list.firstElementChild.tabIndex = 0;
    list.closest('form').querySelector('.mode-confirm').disabled = !id;
  }
  function fill(list, choices, selected, live = false) {
    list.replaceChildren(...choices.map(train => {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'service-option';
      item.setAttribute('role', 'option'); item.dataset.train = train.id;
      item.textContent = `${live ? directionName(train.direction) + '　' : ''}${label(train)}`;
      item.onclick = () => choose(list, train.id); return item;
    }));
    choose(list, selected);
  }
  function refreshCustom(selected = customId) {
    customChoices = services(timetable, $('input[name="direction"]:checked').value, $('input[name="day"]:checked').value);
    fill($('#custom-service'), customChoices, customChoices.some(train => train.id === selected) ? selected : customChoices[0]?.id ?? null);
  }
  function update() {
    const now = Date.now(); liveChoices = activeServices(timetable, now);
    $('#menu-clock').textContent = serviceTime((now - serviceDayEpoch(japanDate(now))) / 1000, true);
    $('#menu-service-status').textContent = liveChoices.length ? '運行中の列車を選んでください。' : '現在はダイヤ上の運行時間外です。CUSTOMで再生できます。';
    const signature = liveChoices.map(train => train.id).join(',');
    if (signature !== liveSignature) {
      liveSignature = signature; fill($('#menu-trains'), liveChoices, liveChoices.some(train => train.id === liveId) ? liveId : null, true);
    }
  }
  for (const mode of ['live', 'custom']) $(`#tab-${mode}`).addEventListener('click', () => tab(mode));
  $('.mode-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); tab(currentTab === 'live' ? 'custom' : 'live'); $(`#tab-${currentTab}`).focus();
  });
  for (const list of dialog.querySelectorAll('.service-list')) list.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !list.children.length) return;
    event.preventDefault(); const items = [...list.children], index = items.indexOf(event.target.closest('[role=option]'));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    choose(list, items[next].dataset.train, true);
  });
  for (const input of dialog.querySelectorAll('input')) input.addEventListener('change', () => refreshCustom());
  $('#mode-custom').addEventListener('submit', event => {
    event.preventDefault(); if (customChoices.some(train => train.id === customId)) onCustom({ trainId: customId, day: $('input[name="day"]:checked').value });
  });
  $('#mode-live').addEventListener('submit', event => {
    event.preventDefault(); update(); const train = liveChoices.find(train => train.id === liveId); if (train) onLive(train);
  });
  function close() {
    if (!active) return;
    active = false; clearInterval(timer); dialog.dataset.state = 'closing'; onCloseStart(menuDuration());
    closeTimer = setTimeout(() => dialog.close(), menuDuration());
  }
  $('.mode-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { active = false; clearInterval(timer); clearTimeout(closeTimer); onClose(); });
  refreshCustom();
  return { dialog, get active() { return active; }, open(mode = currentTab, selection) {
    clearTimeout(closeTimer);
    if (selection) {
      const train = timetable.trains.find(train => train.id === selection.trainId);
      $(`input[name="day"][value="${selection.day === 'holiday' ? 'holiday' : 'weekday'}"]`).checked = true;
      if (train) $(`input[name="direction"][value="${train.direction}"]`).checked = true;
      refreshCustom(selection.trainId); liveId = selection.trainId;
    } else if (!active) {
      $(`input[name="day"][value="${serviceDayAt(Date.now())}"]`).checked = true; refreshCustom();
    }
    tab(mode); liveSignature = undefined; update(); active = true;
    dialog.dataset.state = 'opening'; dialog.style.setProperty('--menu-duration', `${menuDuration()}ms`);
    if (!dialog.open) dialog.showModal();
    void dialog.offsetWidth;
    dialog.dataset.state = 'open'; onOpen(menuDuration());
    clearInterval(timer); timer = setInterval(update, 1000);
  } };
}
