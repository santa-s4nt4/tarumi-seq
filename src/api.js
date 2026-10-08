export const DEFAULT_ENDPOINT = 'http://localhost:8787/api/position';
export const PUBLIC_ENDPOINT = 'https://tarumi-api.santanaruse.workers.dev/api/position';
export const API_INTERVAL_MS = 5000;

export function validateEndpoint(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP(S)のURLを入力してください。');
  if (globalThis.location?.protocol === 'https:' && url.protocol === 'http:') throw new Error('HTTPSページからHTTPのAPIには接続できません。localhost版をご利用ください。');
  return url.href;
}

export class PositionApi {
  constructor(onResult, onStatus, endpoint = DEFAULT_ENDPOINT) {
    this.onResult = onResult; this.onStatus = onStatus; this.endpoint = endpoint;
    this.generation = 0; this.controller = null; this.pending = null; this.lastStarted = -Infinity;
    this.timer = null; this.inFlight = false; this.count = 0;
  }
  reset() {
    this.generation++; this.controller?.abort(); clearTimeout(this.timer);
    this.controller = null; this.pending = null; this.inFlight = false; this.lastStarted = -Infinity;
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
    const delay = Math.max(0, API_INTERVAL_MS - (performance.now() - this.lastStarted));
    this.timer = setTimeout(() => this.run(), delay);
  }
  async run() {
    if (!this.pending || this.inFlight) return;
    const { body, t } = typeof this.pending === 'function' ? this.pending() : this.pending;
    this.pending = null; this.inFlight = true; this.lastStarted = performance.now();
    const generation = this.generation, controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort('timeout'), 8000);
    this.onStatus({ status: 'loading', body, count: ++this.count });
    try {
      const response = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      let result;
      try { result = await response.json(); } catch { throw new Error(`HTTP ${response.status}: JSONではない応答です。APIのURLを確認してください。`); }
      if (!response.ok) throw new Error(`HTTP ${response.status} · ${result.message || result.error || 'APIリクエストに失敗しました。'}`);
      if (!result.position || !result.next || !result.river || !Array.isArray(result.upcoming) || result.direction !== body.direction) throw new Error('tarumi-apiの応答形式と一致しません。URLとdirectionを確認してください。');
      if (generation !== this.generation) return;
      this.onResult(result, t);
      this.onStatus({ status: 'ok', latency: Math.round(performance.now() - this.lastStarted), body, result, count: this.count });
    } catch (error) {
      if (generation !== this.generation) return;
      this.onStatus({ status: 'error', message: controller.signal.aborted ? 'APIの応答が8秒以内に届きませんでした。' : error.message, body, count: this.count });
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) { this.inFlight = false; this.controller = null; this.schedule(); }
    }
  }
}
