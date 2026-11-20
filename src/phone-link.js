import qrcode from 'qrcode-generator';
import { liveRequest } from './live-api.js';
import { LIVE_FRESH_MS } from './live-prediction.js';

export function phoneLink({ button, onFix, onState }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'gps-dialog';
  dialog.innerHTML = `<h2>スマホのGPSを使う</h2>
    <p>乗車するスマホでQRコードを読み取り、「GPSを送信する」を押してください。</p>
    <img alt="スマホのGPS送信画面を開くQRコード" hidden>
    <p class="link-instructions"></p><p class="link-status" role="status"></p>
    <div class="gps-actions"><button class="secondary-button copy-link" hidden>リンクをコピー</button>
    <button class="secondary-button end-link" hidden>連携を終了</button><button class="primary-button close-link">閉じる</button></div>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const img = find('img'), copy = find('.copy-link'), end = find('.end-link'), info = find('.link-status');
  let link, invitation, timer, opening = false, lastTimestamp = 0;
  const status = message => { info.textContent = message; onState(message); };
  const drop = (message, revoke = true) => {
    const previous = link;
    link = null;
    clearTimeout(timer);
    lastTimestamp = 0;
    if (previous && revoke) liveRequest('gps-links/' + previous.id, { method: 'DELETE', token: previous.reader, keepalive: true }).catch(() => {});
    opening = false;
    invitation = null;
    img.removeAttribute('src');
    img.hidden = copy.hidden = end.hidden = true;
    button.textContent = 'スマホのGPSを使う';
    status(message);
  };
  async function poll(current) {
    if (link !== current) return;
    try {
      const { position } = await liveRequest('gps-links/' + current.id, { token: current.reader });
      if (link !== current) return;
      if (position && Date.now() - position.timestamp <= LIVE_FRESH_MS) {
        status('スマホGPS受信中');
        if (position.timestamp > lastTimestamp) { lastTimestamp = position.timestamp; onFix(position); }
      } else status(position ? 'スマホのGPS更新待ち' : 'スマホの送信待ち');
    } catch (error) {
      if (link !== current) return;
      if (error.status === 404 || Date.now() >= current.expiresAt) { drop('スマホ連携は終了しました', false); return; }
      status('スマホ連携の通信を再試行中');
    }
    if (link === current) timer = setTimeout(() => poll(current), 850);
  }
  button.addEventListener('click', async () => {
    dialog.showModal();
    if (link || opening) return;
    opening = true;
    status('連携リンクを作成中');
    try {
      link = await liveRequest('gps-links', { method: 'POST' });
      const url = new URL(import.meta.env.BASE_URL + 'live/', location.origin);
      if (import.meta.env.DEV && (url.protocol !== 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
        const lan = new URL(__PHONE_DEV_ORIGIN__);
        url.protocol = lan.protocol; url.host = lan.host;
        find('.link-instructions').textContent = '同じWi-FiでローカルHTTPS版（npm run dev:phone）を起動し、スマホで開いてください。';
      }
      url.hash = new URLSearchParams({ 'gps-send': link.id, key: link.writer }).toString();
      invitation = url.href;
      const qr = qrcode(0, 'M'); qr.addData(invitation); qr.make();
      img.src = qr.createDataURL(5);
      img.hidden = copy.hidden = end.hidden = false;
      button.textContent = 'スマホ連携を管理';
      poll(link);
    } catch { drop('連携リンクを作成できませんでした。APIの接続を確認してください。'); }
    finally { opening = false; }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(invitation); copy.textContent = 'コピーしました'; }
    catch { window.prompt('スマホで開くリンク', invitation); }
  });
  dialog.addEventListener('close', () => { copy.textContent = 'リンクをコピー'; });
  find('.close-link').addEventListener('click', () => dialog.close());
  end.addEventListener('click', async () => {
    const current = link;
    if (!current) return;
    end.disabled = true;
    try {
      await liveRequest('gps-links/' + current.id, { method: 'DELETE', token: current.reader });
      if (link === current) drop('スマホ連携を終了しました', false);
      dialog.close();
    } catch (error) {
      if (error.status === 404) drop('スマホ連携は終了しました', false);
      else info.textContent = '終了を確認できませんでした。もう一度押してください。';
    } finally { end.disabled = false; }
  });
  window.addEventListener('pagehide', () => { if (link) drop('スマホ連携を終了しました'); });
  return { get active() { return Boolean(link) || opening; } };
}
