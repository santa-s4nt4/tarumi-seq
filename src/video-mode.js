import { buildScene, overlayState, stateKey, drawOverlay } from './video-overlay.js';

let api;
function youTubeAPI() {
  return api ??= new Promise((resolve, reject) => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { api = null; script.remove(); reject(new Error('YouTube IFrame API')); };
    document.head.append(script);
  });
}

// VIDEO has no seek bar of its own: the cues follow the YouTube player's
// position, using the times labelled in video-labeler.
export function createVideoMode({ container, base, direction, onActivity = () => {} }) {
  const stage = document.createElement('div'), target = document.createElement('div'), canvas = document.createElement('canvas');
  stage.className = 'video-stage'; canvas.setAttribute('aria-hidden', 'true');
  stage.append(target, canvas); container.replaceChildren(stage); container.hidden = false;
  const context = canvas.getContext('2d');
  let player, scene, ready = false, destroyed = false, resume = false, drawn, reported, reportedAt = 0, shown = 0;
  const load = async name => {
    const response = await fetch(`${base}data/${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(name); return response.json();
  };
  Promise.all([load(`video-labels-${direction}`), load('video-route'), youTubeAPI(), document.fonts.load('400 32px "Tarumi OTO Stroke"').catch(() => {})]).then(([labels, route, YT]) => {
    if (destroyed) return;
    scene = buildScene(labels.features, route);
    player = new YT.Player(target, { videoId: labels.source.youtubeId, width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0 }, events: { onReady() { ready = true; }, onStateChange() { if (!destroyed) onActivity(); } } });
  }).catch(error => {
    console.error(error);
    if (destroyed) return;
    const message = document.createElement('p'); message.className = 'video-error'; message.setAttribute('role', 'alert');
    message.textContent = '車窓映像を読み込めませんでした。通信状況を確認して再読み込みしてください。';
    container.replaceChildren(message);
  });
  // The player reports its position only a few times a second, so the time in
  // between is carried forward; small backward corrections are not shown.
  function position(now) {
    const time = player.getCurrentTime();
    if (time !== reported) { reported = time; reportedAt = now; }
    if (player.getPlayerState() !== 1) return shown = time;
    const estimate = time + Math.min(.5, Math.max(0, now - reportedAt) / 1000 * player.getPlaybackRate());
    return shown = estimate < shown && shown - estimate < .5 ? shown : estimate;
  }
  return {
    render(now) {
      if (!ready) return;
      const width = Math.round(canvas.clientWidth * devicePixelRatio), height = Math.round(canvas.clientHeight * devicePixelRatio);
      if (!width || !height) return;
      const state = overlayState(scene, position(now), player.getDuration());
      const key = `${width}x${height}:${stateKey(state)}`;
      if (key === drawn) return;
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      drawOverlay(context, state, width, height, scene); drawn = key;
    },
    pause() { resume = ready && player.getPlayerState() === 1; if (resume) player.pauseVideo(); },
    resume() { if (resume && ready) player.playVideo(); resume = false; },
    destroy() { destroyed = true; ready = false; player?.destroy(); player = null; container.replaceChildren(); container.hidden = true; },
  };
}
