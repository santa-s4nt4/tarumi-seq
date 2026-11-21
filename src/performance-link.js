import qrcode from 'qrcode-generator';
import { liveRequest } from './live-api.js';

export function createPerformanceLink({ onFix, onState, onView, onOpen, onClose }) {
  const params = new URLSearchParams(location.hash.slice(1));
  const viewer = params.has('view');
  const dialog = document.createElement('dialog'); dialog.className = 'performance-dialog'; dialog.id = 'performance-qr';
  dialog.setAttribute('aria-label', viewer ? 'PCとの画面連携' : 'スマホのGPSと連携');
  dialog.innerHTML = `<h2>${viewer ? 'PCと画面を共有' : 'スマホと連携'}</h2>
    <p>${viewer ? 'PCで選択した列車・視点を表示します。' : '乗車するスマホでQRコードを読み取ってください。<br>接続すると地図に切り替わります。'}</p>
    <img alt="スマホのGPS送信画面を開くQRコード" hidden><p class="performance-link-status" role="status"></p>
    <button class="performance-retry" hidden>新しいQRコードを作る</button>
    <details class="performance-links" hidden><summary>接続リンク・iPadで見る</summary>
      <p>スマホで「GPSを送信する」を押すと補正を開始します。</p><a class="sender-link" target="_blank" rel="noopener">スマホ送信画面を開く</a>
      <p>同じWi-FiのiPadで、以下の閲覧リンクを開いてください。</p><input readonly aria-label="iPad閲覧リンク"><button class="copy-view">閲覧リンクをコピー</button>
      <p>スマホのGPSにはHTTPSが必要です。初回はローカル証明書を信頼してから接続してください。</p></details>`;
  document.body.append(dialog);
  dialog.addEventListener('cancel', event => event.preventDefault());
  dialog.addEventListener('close', onClose);
  const $ = selector => dialog.querySelector(selector), info = $('.performance-link-status');
  let link, timer, opening = false, lastTimestamp = 0, openedAt = 0, pendingView, publishing = false, restoreView = true;
  const storageKey = 'tarumi-performance-session';
  const valid = item => /^[a-f0-9-]{36}$/.test(item?.id) && /^[a-f0-9]{64}$/.test(item?.reader);
  if (viewer) link = { id: params.get('view'), reader: params.get('key'), expiresAt: Infinity };
  else try { const saved = JSON.parse(sessionStorage.getItem(storageKey)); if (valid(saved) && saved.expiresAt > Date.now()) link = saved; } catch { /* storage optional */ }
  function status(message) { info.textContent = message; onState(message); }
  function unavailable(message) {
    clearTimeout(timer); link = null;
    if (!viewer) try { sessionStorage.removeItem(storageKey); } catch { /* optional */ }
    $('img').hidden = $('.performance-links').hidden = true;
    $('.performance-retry').hidden = viewer; status(message);
    if (!dialog.open) { onOpen(); dialog.showModal(); }
  }
  function invitations() {
    if (viewer || !link?.writer) return;
    const origin = typeof __PHONE_DEV_ORIGIN__ === 'string' ? __PHONE_DEV_ORIGIN__ : location.origin;
    const sender = new URL(import.meta.env.BASE_URL + 'performance/', origin);
    sender.hash = new URLSearchParams({ 'gps-send': link.id, key: link.writer });
    const qr = qrcode(0, 'M'); qr.addData(sender.href); qr.make();
    $('img').src = qr.createDataURL(5, 4); $('img').hidden = false;
    $('.sender-link').href = sender.href;
    const shared = new URL(import.meta.env.BASE_URL + 'performance/', origin.replace(':5174', ':5173').replace('https:', 'http:'));
    shared.hash = new URLSearchParams({ view: link.id, key: link.reader });
    $('input').value = shared.href; $('.performance-links').hidden = false;
  }
  async function poll(current) {
    if (link !== current) return;
    try {
      const result = await liveRequest('gps-links/' + current.id, { token: current.reader });
      if (link !== current) return;
      current.expiresAt = result.expiresAt;
      if (viewer || restoreView) onView(result.view);
      restoreView = false;
      if (dialog.open && (viewer ? Boolean(result.view) : result.joinedAt >= openedAt && result.joinedAt > 0)) dialog.close();
      if (result.position && Date.now() - result.position.timestamp <= 3000) {
        status('スマホGPS受信中');
        if (result.position.timestamp > lastTimestamp) { lastTimestamp = result.position.timestamp; onFix(result.position); }
      } else status(result.position ? 'GPS更新待ち · ダイヤで追従中' : viewer ? 'PCの列車選択を待っています' : 'スマホでGPS送信を開始してください');
    } catch (error) {
      if (link !== current) return;
      if (error.status === 404 || Date.now() >= current.expiresAt) { unavailable('連携が終了しました。新しいリンクで接続してください。'); return; }
      status('PCとの通信を再試行しています');
    }
    if (link === current) timer = setTimeout(() => poll(current), 850);
  }
  async function open() {
    openedAt = Date.now();
    if (!dialog.open) { onOpen(); dialog.showModal(); }
    if (opening) return;
    if (viewer && !valid(link)) { unavailable('閲覧リンクが無効です。PCのメニューからリンクを開き直してください。'); return; }
    if (!link) {
      opening = true; $('.performance-retry').hidden = true; status('接続を準備しています');
      try {
        link = await liveRequest('gps-links', { method: 'POST' });
        try { sessionStorage.setItem(storageKey, JSON.stringify(link)); } catch { /* optional */ }
      } catch { unavailable('接続を準備できません。ローカルAPIの起動を確認してください。'); }
      finally { opening = false; }
    }
    if (link) { invitations(); clearTimeout(timer); poll(link); }
  }
  async function flush() {
    if (publishing || viewer || !link) return;
    publishing = true;
    try {
      while (pendingView && link) {
        const next = pendingView; pendingView = null;
        try { await liveRequest('gps-links/' + link.id, { method: 'PATCH', token: link.reader, body: next }); }
        catch { pendingView ??= next; status('画面共有を再試行しています'); setTimeout(flush, 2000); break; }
      }
    } finally { publishing = false; }
  }
  $('.performance-retry').onclick = open;
  $('.copy-view').onclick = async () => {
    try { await navigator.clipboard.writeText($('input').value); $('.copy-view').textContent = 'コピーしました'; }
    catch { $('input').select(); $('.copy-view').textContent = '選択したリンクをコピーしてください'; }
  };
  window.addEventListener('pagehide', () => clearTimeout(timer));
  return { dialog, viewer, open, publish(value) { pendingView = value; flush(); } };
}
