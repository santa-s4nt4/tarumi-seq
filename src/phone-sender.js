import './style.css';
import './gps-tools.css';
import { LiveSession } from './live-session.js';
import { liveRequest } from './live-api.js';

const params = new URLSearchParams(location.hash.slice(1));
const id = params.get('gps-send'), token = params.get('key');
const valid = /^[a-f0-9-]{36}$/.test(id) && /^[a-f0-9]{64}$/.test(token);
document.title = 'スマホGPS送信 | 樽見OTO鉄道';
document.body.className = 'gps-sender';
document.body.innerHTML = `<main><span class="loading-logo loading-wordmark" role="img" aria-label="樽見OTO鉄道"></span>
  <h1>スマホGPS送信</h1><p>このスマホの現在地を、連携したPCの画面に送ります。乗車中はこの画面を開いておいてください。</p>
  <button class="primary-button" id="send-gps">GPSを送信する</button>
  <p role="status" id="sender-status"></p></main>`;
const button = document.getElementById('send-gps'), output = document.getElementById('sender-status');
const resource = 'gps-links/' + id;
let heartbeat, pending, sending = false, controller, closed = !valid;
const messages = { waiting: '位置情報を取得しています', hidden: '送信を一時停止しました', denied: '位置情報の使用を許可してから、もう一度押してください。',
  insecure: 'スマホの位置情報を使うにはHTTPSで開いてください。', unsupported: 'このブラウザーは位置情報に対応していません。',
  unavailable: '位置情報を取得できません', timeout: 'GPS更新待ち', stopped: '送信を終了しました。' };
const session = new LiveSession({
  onFix(position) {
    const { latitude, longitude, accuracy, speed } = position.coords;
    pending = { timestamp: position.timestamp, latitude, longitude, accuracy, speed };
    flush();
  },
  onStatus(status) {
    clearTimeout(heartbeat);
    if (session.active) heartbeat = setTimeout(checkLink, 5000);
    if (!session.active) { pending = null; controller?.abort(); }
    output.textContent = messages[status] ?? '';
    button.textContent = session.active ? '送信を終了' : 'GPSを送信する';
  },
});
function expired() {
  closed = true;
  session.stop();
  button.disabled = true;
  output.textContent = '連携が終了しました。PCで新しいQRコードを開いてください。';
}
async function checkLink() {
  const generation = session.generation;
  try { await liveRequest(resource, { method: 'HEAD', token }); }
  catch (error) { if (error.status === 404 && session.generation === generation) expired(); }
  if (session.active && generation === session.generation) heartbeat = setTimeout(checkLink, 5000);
}
async function flush() {
  if (sending) return;
  sending = true;
  try {
    while (session.active && pending) {
      const fix = pending;
      pending = null;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        await liveRequest(resource, { method: 'PUT', token, body: fix, signal: controller.signal });
        if (session.active) output.textContent = 'PCに送信中 · 測位精度 ±' + Math.round(fix.accuracy) + ' m';
      } catch (error) {
        if (error.status === 404) expired();
        else if (session.active) output.textContent = '送信できませんでした。次の測位で再試行します。';
      } finally { clearTimeout(timeout); }
    }
  } finally { sending = false; }
}
button.disabled = closed;
output.textContent = valid ? '送信待ち' : '連携リンクが無効です。PCでQRコードを開いてください。';
// Opening the invitation only acknowledges the scan. Geolocation still starts
// exclusively from the explicit button below.
if (valid) liveRequest(resource + '/join', { method: 'POST', token }).catch(error => {
  if (error.status === 404) expired();
  else output.textContent = 'PCと接続できません。通信状況を確認して再読み込みしてください。';
});
button.addEventListener('click', async () => {
  if (!session.active && !closed) { session.start(); return; }
  session.stop();
  closed = true; button.disabled = true;
  try { await liveRequest(resource, { method: 'DELETE', token, keepalive: true }); }
  catch (error) {
    if (error.status !== 404) {
      output.textContent = 'GPSを停止しました。通信が戻ったら連携を終了してください。';
      button.textContent = '連携を終了'; button.disabled = false;
    }
  }
});
const pause = () => { if (session.active) session.stop('hidden'); };
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('pagehide', pause);
