export const PUBLIC_ENDPOINT = 'https://tarumi-api.santanaruse.workers.dev/api/position';
export const LOCAL_ENDPOINT = 'http://localhost:8787/api/position';
export const DEFAULT_ENDPOINT = PUBLIC_ENDPOINT;
export const API_INTERVAL_MS = 5000;
const LOCAL_RETRY_DELAY_MS = 300;

function isLocalPositionEndpoint(endpoint) {
  const url = new URL(endpoint);
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '8787' && url.pathname === '/api/position';
}

function waitForRetry(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Request cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, LOCAL_RETRY_DELAY_MS);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

// Keep the selected endpoint visible in settings; use Vite only for local development requests.
export function requestEndpoint(endpoint, useLocalProxy = import.meta.env?.DEV === true) {
  const url = new URL(endpoint);
  if (useLocalProxy && isLocalPositionEndpoint(endpoint)) {
    return `/local-api${url.pathname}${url.search}`;
  }
  return endpoint;
}

export function validateEndpoint(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP(S)のURLを入力してください。');
  if (globalThis.location?.protocol === 'https:' && url.protocol === 'http:') throw new Error('HTTPSページからHTTPのAPIには接続できません。localhost版をご利用ください。');
  return url.href;
}

export class PositionApi {
  constructor(onResult, onStatus, endpoint = DEFAULT_ENDPOINT) {
    this.onResult = onResult; this.onStatus = onStatus; this.endpoint = endpoint;
    this.generation = 0; this.controller = null; this.pending = null; this.lastStarted = -Infinity; this.lastCompleted = -Infinity;
    this.timer = null; this.inFlight = false; this.count = 0;
  }
  reset() {
    this.generation++; this.controller?.abort(); clearTimeout(this.timer);
    this.controller = null; this.pending = null; this.inFlight = false; this.lastStarted = -Infinity; this.lastCompleted = -Infinity;
  }
  cancelPending() { clearTimeout(this.timer); this.pending = null; }
  enqueue(body, t, immediate = false) {
    if (immediate) this.reset();
    this.pending = typeof body === 'function' ? body : { body, t };
    this.schedule();
  }
  schedule() {
    if (!this.pending || this.inFlight) return;
    clearTimeout(this.timer);
    // Avoid Wrangler's 5s idle-connection boundary by spacing polls from completion.
    const delay = Math.max(0, API_INTERVAL_MS - (performance.now() - this.lastCompleted));
    this.timer = setTimeout(() => this.run(), delay);
  }
  async run() {
    if (!this.pending || this.inFlight) return;
    const { body, t } = typeof this.pending === 'function' ? this.pending() : this.pending;
    this.pending = null; this.inFlight = true; this.lastStarted = performance.now();
    const generation = this.generation, controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 8000);
    try {
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        this.onStatus({ status: 'loading', body, count: ++this.count });
        try {
          const response = await fetch(requestEndpoint(this.endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
          const text = await response.text();
          try { result = JSON.parse(text); } catch { result = null; }
          if (!response.ok) {
            const droppedConnection = response.status >= 500 && /Network connection lost|Your worker restarted mid-request|local_api_unavailable/.test(text);
            const message = result?.message || result?.error || (droppedConnection ? 'ローカルAPIの開発サーバー内で通信が切断されました。' : 'APIリクエストに失敗しました。');
            const error = new Error(`HTTP ${response.status} · ${message}`);
            error.retryable = droppedConnection;
            throw error;
          }
          if (!result) throw new Error(`HTTP ${response.status}: JSONではない応答です。APIのURLを確認してください。`);
          break;
        } catch (error) {
          // This POST only reads predictions. Replay once for known local transport failures;
          // do not retry validation errors, dataset errors, or any public API request.
          const networkFailure = error instanceof TypeError && /fetch|network/i.test(error.message);
          if (attempt > 0 || !isLocalPositionEndpoint(this.endpoint) || !(error.retryable || networkFailure) || controller.signal.aborted || generation !== this.generation) throw error;
          await waitForRetry(controller.signal);
        }
      }
      if (!result.position || !result.next || !result.river || !Array.isArray(result.upcoming) || result.direction !== body.direction) throw new Error('tarumi-apiの応答形式と一致しません。URLとdirectionを確認してください。');
      if (generation !== this.generation) return;
      this.onResult(result, t);
      this.onStatus({ status: 'ok', latency: Math.round(performance.now() - this.lastStarted), body, result, count: this.count });
    } catch (error) {
      if (generation !== this.generation) return;
      this.onStatus({ status: 'error', message: controller.signal.aborted ? 'APIの応答が8秒以内に届きませんでした。' : error.message, body, count: this.count });
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) { this.lastCompleted = performance.now(); this.inFlight = false; this.controller = null; this.schedule(); }
    }
  }
}
