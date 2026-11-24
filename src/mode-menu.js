import { activeServices, services, customTimetable, directionName, serviceLabel } from './journey.js';
import { serviceTime } from './simulation.js';
import { serviceDayAt, japanDate, serviceDayEpoch } from './timetable-reference.js';
import { menuDuration } from './menu-motion.js';

export function createModeMenu({ timetable, stations, onLive, onCustom, onVideo, now: clock = Date.now, dismissible = true, beforeOpen = () => {}, onOpen = () => {}, onCloseStart = () => {}, onClose = () => {} }) {
  const customSchedule = customTimetable(timetable);
  const dialog = document.createElement('dialog');
  dialog.id = 'mode-menu'; dialog.className = 'mode-menu'; dialog.setAttribute('aria-label', 'モードを選ぶ');
  dialog.innerHTML = `<button class="mode-close" type="button" aria-label="メニューを閉じる"></button>
    <div class="mode-tabs" role="tablist" aria-label="モード" tabindex="-1">
      <button id="tab-live" role="tab" aria-selected="true" aria-controls="mode-live">LIVE</button>
      <button id="tab-custom" role="tab" aria-selected="false" aria-controls="mode-custom">CUSTOM</button>
      <button id="tab-video" role="tab" aria-selected="false" aria-controls="mode-video">VIDEO</button>
    </div>
    <form id="mode-live" role="tabpanel" aria-labelledby="tab-live">
      <time id="menu-clock" aria-label="現在時刻"></time><p id="menu-service-status" role="status"></p>
      <div id="menu-trains" class="service-list" role="listbox" aria-label="運行中の列車"></div>
      <button class="mode-confirm" type="submit" disabled>OK</button>
    </form>
    <form id="mode-custom" role="tabpanel" aria-labelledby="tab-custom" hidden>
      <fieldset><legend>方面</legend><label><input type="radio" name="direction" value="front" checked><span>樽見行き</span></label><label><input type="radio" name="direction" value="back"><span>本巣行き</span></label></fieldset>
      <span class="service-select-label" id="custom-service-label">発車駅・ダイヤ</span>
      <div id="custom-service" class="service-list" role="listbox" aria-labelledby="custom-service-label"></div>
      <button class="mode-confirm" type="submit">OK</button>
    </form>
    <form id="mode-video" role="tabpanel" aria-labelledby="tab-video" hidden>
      <p class="mode-video-note">車窓映像を再生します。合図は映像の再生位置に合わせて表示します。</p>
      <div id="video-service" class="service-list" role="listbox" aria-label="車窓映像"></div>
      <button class="mode-confirm" type="submit">OK</button>
    </form>`;
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const customList = $('#custom-service');
  new ResizeObserver(([entry]) => {
    const option = customList.firstElementChild;
    const height = entry.contentRect.height;
    if (!option || !height) return;
    const minRowHeight = parseFloat(getComputedStyle(option).minHeight);
    const visibleRows = Math.max(1, Math.floor(height / minRowHeight));
    customList.style.setProperty('--row-height', `${height / visibleRows}px`);
  }).observe(customList);
  $('.mode-close').hidden = !dismissible;
  const label = train => serviceLabel(train, stations);
  const modes = ['live', 'custom', 'video'];
  let currentTab = 'live', timer, closeTimer, active = false, opening = false, liveId = null, customId = null, videoId = 'back', liveChoices = [], customChoices = [], liveSignature;
  function tab(value) {
    currentTab = value;
    for (const mode of modes) {
      $(`#tab-${mode}`).setAttribute('aria-selected', String(mode === value)); $(`#tab-${mode}`).tabIndex = mode === value ? 0 : -1;
      $(`#mode-${mode}`).hidden = mode !== value;
    }
    requestAnimationFrame(() => $(`#mode-${value} [role=option][aria-selected=true]`)?.scrollIntoView({ block:'nearest' }));
  }
  function choose(list, id, focus = false) {
    if (list.id === 'menu-trains') liveId = id; else if (list.id === 'video-service') videoId = id; else customId = id;
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
  // One list for every operating day: the 'holiday' set is the daily trains
  // plus any that run on holidays only.
  function refreshCustom(selected = customId) {
    customChoices = services(customSchedule, $('input[name="direction"]:checked').value, 'holiday');
    customList.style.setProperty('--service-count', customChoices.length);
    fill(customList, customChoices, customChoices.some(train => train.id === selected) ? selected : customChoices[0]?.id ?? null);
  }
  function update() {
    const now = clock(); liveChoices = activeServices(timetable, now);
    $('#menu-clock').textContent = serviceTime((now - serviceDayEpoch(japanDate(now))) / 1000, true);
    $('#menu-service-status').textContent = liveChoices.length ? '本巣〜樽見間を運行中の列車を選んでください。' : '現在、本巣〜樽見間を運行中の列車はありません。CUSTOMで再生できます。';
    const signature = liveChoices.map(train => train.id).join(',');
    if (signature !== liveSignature) {
      liveSignature = signature; fill($('#menu-trains'), liveChoices, liveChoices.some(train => train.id === liveId) ? liveId : null, true);
    }
  }
  // The thumbnails are YouTube's own, for the videos named in video-labels-*.json.
  $('#video-service').replaceChildren(...[['front', '本巣発　樽見行き', 'm-jjJKsWI24'], ['back', '樽見発　本巣行き', '7O6dZcTG2mQ']].map(([direction, text, youtubeId]) => {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'service-option';
    item.setAttribute('role', 'option'); item.dataset.train = direction;
    const thumbnail = document.createElement('img'), name = document.createElement('span');
    thumbnail.src = `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg`; thumbnail.alt = ''; thumbnail.loading = 'lazy';
    thumbnail.width = 320; thumbnail.height = 180; thumbnail.onerror = () => thumbnail.remove();
    name.textContent = text; item.append(thumbnail, name);
    item.onclick = () => choose($('#video-service'), direction); return item;
  }));
  choose($('#video-service'), videoId);
  for (const mode of modes) $(`#tab-${mode}`).addEventListener('click', () => tab(mode));
  $('.mode-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); tab(modes.at((modes.indexOf(currentTab) + (event.key === 'ArrowLeft' ? -1 : 1)) % modes.length)); $(`#tab-${currentTab}`).focus();
  });
  for (const list of dialog.querySelectorAll('.service-list')) list.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !list.children.length) return;
    event.preventDefault(); const items = [...list.children], index = items.indexOf(event.target.closest('[role=option]'));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
    choose(list, items[next].dataset.train, true);
  });
  for (const input of dialog.querySelectorAll('input')) input.addEventListener('change', () => refreshCustom());
  $('#mode-custom').addEventListener('submit', event => {
    event.preventDefault(); const train = customChoices.find(train => train.id === customId);
    if (train) onCustom({ trainId: train.id, day: train.operatingDays === 'holiday' ? 'holiday' : serviceDayAt(clock()) });
  });
  $('#mode-video').addEventListener('submit', event => { event.preventDefault(); onVideo(videoId); });
  $('#mode-live').addEventListener('submit', event => {
    event.preventDefault(); update(); const train = liveChoices.find(train => train.id === liveId); if (train) onLive(train);
  });
  function close() {
    if (!active || !dismissible) return;
    active = false; clearInterval(timer); dialog.dataset.state = 'closing'; onCloseStart(menuDuration());
    closeTimer = setTimeout(() => dialog.close(), menuDuration());
  }
  $('.mode-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) { event.preventDefault(); close(); } });
  dialog.addEventListener('close', () => { active = false; clearInterval(timer); clearTimeout(closeTimer); onClose(); });
  refreshCustom();
  return { dialog, close, get active() { return active; },
    get visibleLiveChoices() { return active && currentTab === 'live' ? liveChoices : null; },
    setDismissible(value) { dismissible = value; $('.mode-close').hidden = !value; },
    setVideo(direction) { choose($('#video-service'), direction); }, async open(mode = currentTab, selection) {
    if (opening) return;
    if (!active) { opening = true; await beforeOpen(); opening = false; }
    clearTimeout(closeTimer);
    if (selection) {
      const train = timetable.trains.find(train => train.id === selection.trainId);
      if (train) $(`input[name="direction"][value="${train.direction}"]`).checked = true;
      refreshCustom(selection.trainId); liveId = selection.trainId;
    } else if (!active) refreshCustom();
    tab(mode); liveSignature = undefined; update(); active = true;
    dialog.dataset.state = 'opening'; dialog.style.setProperty('--menu-duration', `${menuDuration()}ms`);
    if (!dialog.open) {
      dialog.show();
      if (!dismissible) $('.mode-tabs').focus({ preventScroll: true });
    }
    void dialog.offsetWidth;
    dialog.dataset.state = 'open'; onOpen(menuDuration());
    clearInterval(timer); timer = setInterval(update, 1000);
  } };
}
