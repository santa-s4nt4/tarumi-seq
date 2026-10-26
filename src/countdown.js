import './countdown.css';

// Use the same first checkpoint as UP NEXT. Playback time drives the dial, so
// pausing, seeking and changing speed keep the number and motion together.
export function createCueCountdown(parent) {
  const element = document.createElement('section');
  element.id = 'cue-countdown-focus';
  element.className = 'countdown-focus';
  element.hidden = true;
  element.setAttribute('aria-labelledby', 'countdown-target');
  const ticks = Array.from({ length: 120 }, (_, index) =>
    `<line x1="180" y1="16" x2="180" y2="${index % 10 === 0 ? 40 : 31}" transform="rotate(${index * 3} 180 180)" />`).join('');
  element.innerHTML = `<div class="countdown-heading"><span id="countdown-kind" lang="en"></span><span>まもなく</span></div>
    <h2 id="countdown-target"></h2>
    <div class="countdown-clock">
      <svg class="countdown-ring" viewBox="0 0 360 360" aria-hidden="true">
        <defs>
          <g id="countdown-ticks">${ticks}</g>
          <mask id="countdown-progress-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="360" height="360">
            <circle class="countdown-progress" cx="180" cy="180" r="152" fill="none" stroke="white" stroke-width="32" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 180 180)" />
          </mask>
        </defs>
        <use href="#countdown-ticks" class="countdown-ticks-track" />
        <use href="#countdown-ticks" mask="url(#countdown-progress-mask)" />
        <g class="countdown-hand"><line x1="180" y1="10" x2="180" y2="42" /></g>
      </svg>
      <p class="countdown-value"><strong id="countdown-seconds"></strong><span>秒</span></p>
    </div>`;
  parent.append(element);
  const target = element.querySelector('#countdown-target');
  const kind = element.querySelector('#countdown-kind');
  const seconds = element.querySelector('#countdown-seconds');
  const progress = element.querySelector('.countdown-progress');
  const hand = element.querySelector('.countdown-hand');
  let previousKey = null;
  return {
    update(event) {
      const eta = event?.etaSeconds;
      const visible = (event?.type === 'station' || event?.type === 'tunnel') && Number.isFinite(eta) && eta > 0 && eta <= 10;
      if (element.hidden === visible) {
        element.hidden = !visible;
        parent.classList.toggle('countdown-active', visible);
        document.body.classList.toggle('countdown-mode', visible);
      }
      if (!visible) { previousKey = null; return; }
      const key = `${event.key}:${event.target}`;
      if (key !== previousKey) {
        target.textContent = event.type === 'station' ? `${event.name}駅まで` : `${event.name}${event.target === 'exit' ? '通過' : ''}まで`;
        kind.textContent = event.type === 'station' ? 'NEXT STATION' : event.target === 'exit' ? 'TUNNEL PASSAGE' : 'NEXT TUNNEL';
        element.dataset.type = event.type;
        element.dataset.target = event.target;
        previousKey = key;
      }
      const label = String(Math.ceil(eta));
      if (seconds.textContent !== label) seconds.textContent = label;
      const elapsed = (10 - eta) / 10;
      progress.style.strokeDasharray = `${(elapsed * 100).toFixed(3)} 100`;
      hand.style.transform = `rotate(${(elapsed * 360).toFixed(3)}deg)`;
    },
  };
}
