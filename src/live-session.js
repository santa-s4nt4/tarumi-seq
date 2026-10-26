// Geolocation is requested only after an explicit Start action. A generation
// token prevents late permission/fix callbacks from restarting a stopped run.
export class LiveSession {
  constructor({ onFix, onStatus, geolocation = navigator.geolocation, wakeLock = navigator.wakeLock, secure = window.isSecureContext }) {
    Object.assign(this, { onFix, onStatus, geolocation, wakeLock, secure });
    this.active = false; this.generation = 0; this.watchId = null; this.lock = null;
  }
  async start() {
    if (this.active) return;
    if (!this.secure) { this.onStatus('insecure'); return; }
    if (!this.geolocation) { this.onStatus('unsupported'); return; }
    this.active = true;
    const generation = ++this.generation;
    this.onStatus('waiting');
    try {
      const id = this.geolocation.watchPosition(position => {
        if (this.active && generation === this.generation) this.onFix(position);
      }, error => {
        if (!this.active || generation !== this.generation) return;
        if (error.code === 1) this.stop('denied');
        else this.onStatus(error.code === 3 ? 'timeout' : 'unavailable');
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
      if (this.active && generation === this.generation) this.watchId = id;
      else this.geolocation.clearWatch(id);
    } catch { this.stop('unavailable'); return; }
    if (!this.active || generation !== this.generation) return;
    try {
      const lock = await this.wakeLock?.request('screen');
      if (!lock) return;
      if (!this.active || generation !== this.generation) await lock.release();
      else this.lock = lock;
    } catch { /* Screen wake lock is optional; GPS remains usable. */ }
  }
  stop(reason = 'stopped') {
    this.active = false; this.generation++;
    if (this.watchId !== null) this.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
    const lock = this.lock; this.lock = null;
    if (lock) Promise.resolve(lock.release()).catch(() => {});
    this.onStatus(reason);
  }
}
