import { serviceTime } from './simulation.js';
import { StationRange } from './journey.js';
import { createIcons, SkipBack, SkipForward, RotateCcw, RotateCw, Play, Pause } from 'lucide';

export function createStationTimeline({ container, plan, from, to, onSeek, onRange, onPlay }) {
  const range = new StationRange(plan.stops, from, to), lastIndex = plan.stops.length - 1;
  container.innerHTML = `<div class="section-summary"><span>再生区間</span><strong id="section-name"></strong><span class="timeline-tunnel-key"><i aria-hidden="true"></i>トンネル</span><span class="range-help">IN / OUT を駅に合わせて移動</span></div>
    <div class="station-timeline-scroll"><div class="station-timeline">
      <div class="station-labels"></div><div class="station-tunnels" role="group" aria-label="トンネル区間"></div><div class="station-track"><div class="station-selected"></div><span class="station-playhead"></span></div>
      <input id="custom-seek" type="range" min="0" max="1000" step="0.1" value="0" aria-label="ダイヤの再生位置">
      <button class="range-marker range-in" role="slider" aria-label="再生開始駅 IN" aria-valuemin="0">IN</button>
      <button class="range-marker range-out" role="slider" aria-label="再生終了駅 OUT">OUT</button>
    </div></div>
    <div class="transport-row"><div class="transport">
      <button id="custom-prev" class="icon-button" aria-label="前の駅へ"><i data-lucide="skip-back"></i></button>
      <button id="custom-back" class="skip-button" aria-label="10秒戻る"><i data-lucide="rotate-ccw"></i><span>10</span></button>
      <button id="custom-play" class="play-button" aria-label="再生" aria-pressed="false"><i data-lucide="play"></i></button>
      <button id="custom-forward" class="skip-button" aria-label="10秒進む"><i data-lucide="rotate-cw"></i><span>10</span></button>
      <button id="custom-next" class="icon-button" aria-label="次の駅へ"><i data-lucide="skip-forward"></i></button>
      <div class="time-display"><strong id="custom-time"></strong><span>/</span><span class="transport-end"></span></div>
    </div></div>`;
  const $ = selector => container.querySelector(selector), track = $('.station-timeline');
  const icons = { SkipBack, SkipForward, RotateCcw, RotateCw, Play, Pause };
  const paintIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.7 } });
  paintIcons();
  track.style.minWidth = `${Math.max(500, plan.stops.length * 72)}px`;
  const times = plan.stops.map((stop, i) => i === 0 ? stop.departureSeconds : stop.arrivalSeconds);
  function percentage(time) {
    if (time <= times[0]) return 0;
    for (let i = 1; i < times.length; i++) if (time <= times[i]) return (i - 1 + (time - times[i - 1]) / (times[i] - times[i - 1])) / lastIndex * 100;
    return 100;
  }
  function atPercent(value) {
    const step = Math.max(0, Math.min(lastIndex, value / 100 * lastIndex));
    const i = Math.min(lastIndex - 1, Math.floor(step));
    return times[i] + (times[i + 1] - times[i]) * (step - i);
  }
  plan.stops.forEach((stop, index) => {
    const button = document.createElement('button'); button.className = 'custom-station';
    button.textContent = stop.name; button.style.left = `${index / lastIndex * 100}%`;
    button.setAttribute('aria-label', `${stop.name}駅へ移動`);
    button.onclick = () => onSeek(range.clamp(times[index])); $('.station-labels').append(button);
  });
  const tunnelMarkers = plan.tunnels.map(tunnel => {
    const marker = document.createElement('span'); marker.className = 'timeline-tunnel';
    marker.style.left = `${percentage(tunnel.entryT)}%`;
    marker.style.width = `${percentage(tunnel.exitT) - percentage(tunnel.entryT)}%`;
    marker.title = `${tunnel.name} · ${serviceTime(tunnel.entryT, true)}–${serviceTime(tunnel.exitT, true)}`;
    marker.setAttribute('role', 'img'); marker.setAttribute('aria-label', marker.title);
    $('.station-tunnels').append(marker);
    return { tunnel, marker };
  });
  $('.timeline-tunnel-key').hidden = !tunnelMarkers.length;
  let current = range.start, playing = false, renderedPlaying = false;
  function paintRange() {
    const start = range.first / lastIndex * 100, end = range.last / lastIndex * 100;
    $('.station-selected').style.left = `${start}%`; $('.station-selected').style.width = `${end - start}%`;
    for (const [which, index] of [['in', range.first], ['out', range.last]]) {
      const handle = $(`.range-${which}`); handle.style.left = `${index / lastIndex * 100}%`;
      handle.setAttribute('aria-valuenow', index); handle.setAttribute('aria-valuetext', plan.stops[index].name);
      handle.setAttribute('aria-valuemin', which === 'in' ? 0 : range.first + 1);
      handle.setAttribute('aria-valuemax', which === 'in' ? range.last - 1 : lastIndex);
    }
    for (const [i, label] of [...$('.station-labels').children].entries()) label.classList.toggle('outside-section', i < range.first || i > range.last);
    for (const { tunnel, marker } of tunnelMarkers) marker.classList.toggle('outside-section', tunnel.exitT <= range.start || tunnel.entryT >= range.end);
    $('#section-name').textContent = `${plan.stops[range.first].name} → ${plan.stops[range.last].name}`;
    $('.transport-end').textContent = serviceTime(range.end, true);
  }
  function change(which, index) { range.set(which, index); paintRange(); onRange(range); }
  for (const which of ['in', 'out']) {
    const handle = $(`.range-${which}`);
    const move = event => {
      const rect = track.getBoundingClientRect();
      change(which, Math.round((event.clientX - rect.left) / rect.width * lastIndex));
    };
    handle.addEventListener('pointerdown', event => { event.preventDefault(); handle.setPointerCapture(event.pointerId); handle.focus(); });
    handle.addEventListener('pointermove', event => { if (handle.hasPointerCapture(event.pointerId)) move(event); });
    handle.addEventListener('pointerup', event => { if (handle.hasPointerCapture(event.pointerId)) { move(event); handle.releasePointerCapture(event.pointerId); } });
    handle.addEventListener('keydown', event => {
      const index = which === 'in' ? range.first : range.last;
      if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); change(which, event.key === 'Home' ? 0 : event.key === 'End' ? lastIndex : index + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1));
      }
    });
  }
  $('#custom-seek').addEventListener('input', event => onSeek(range.clamp(atPercent(Number(event.target.value) / 10))));
  $('#custom-play').onclick = () => onPlay(!playing);
  $('#custom-back').onclick = () => onSeek(range.clamp(current - 10));
  $('#custom-forward').onclick = () => onSeek(range.clamp(current + 10));
  $('#custom-prev').onclick = () => onSeek(range.clamp([...times].reverse().find(time => time < current - 1) ?? range.start));
  $('#custom-next').onclick = () => onSeek(range.clamp(times.find(time => time > current + 1) ?? range.end));
  paintRange();
  return { range, update(time, active) {
    current = time; playing = active;
    const percent = percentage(time);
    $('.station-playhead').style.left = `${percent}%`; $('#custom-seek').value = percent * 10;
    $('#custom-seek').setAttribute('aria-valuetext', serviceTime(time, true));
    $('#custom-time').textContent = serviceTime(time, true);
    if (playing !== renderedPlaying) {
      $('#custom-play').innerHTML = `<i data-lucide="${playing ? 'pause' : 'play'}"></i>`;
      $('#custom-play').setAttribute('aria-label', playing ? '一時停止' : '再生');
      $('#custom-play').setAttribute('aria-pressed', String(playing));
      paintIcons(); renderedPlaying = playing;
    }
    $('#custom-prev').disabled = $('#custom-back').disabled = time <= range.start;
    $('#custom-next').disabled = $('#custom-forward').disabled = time >= range.end;
  } };
}
