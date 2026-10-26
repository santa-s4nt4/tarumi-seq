import './theme.css';

const transitions = new WeakMap();
const duration = 900;

// Copy the previous WebGL frame during Mapbox's render event, while its drawing
// buffer is valid. This avoids enabling preserveDrawingBuffer for every frame.
export function fadeMapTheme(map, applyTheme) {
  let state = transitions.get(map);
  if (!state) { state = { revision: 0, layer: null, animation: null }; transitions.set(map, state); }
  const revision = ++state.revision;
  const clear = () => {
    state.animation?.cancel();
    state.layer?.remove();
    state.animation = state.layer = null;
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    clear();
    applyTheme();
    return;
  }
  map.once('render', () => {
    if (revision !== state.revision) return;
    const source = map.getCanvas();
    const layer = document.createElement('canvas');
    layer.className = 'map-theme-fade';
    layer.setAttribute('aria-hidden', 'true');
    layer.width = source.width;
    layer.height = source.height;
    const context = layer.getContext('2d');
    if (!context) { clear(); applyTheme(); return; }
    context.drawImage(source, 0, 0);
    // A seek can reverse the theme mid-fade. Preserve the currently visible
    // composite instead of flashing back to either endpoint.
    if (state.layer) {
      context.globalAlpha = Number(getComputedStyle(state.layer).opacity);
      context.drawImage(state.layer, 0, 0, layer.width, layer.height);
    }
    clear();
    state.layer = layer;
    map.getCanvasContainer().append(layer);
    map.once('render', () => {
      if (revision !== state.revision || state.layer !== layer) return;
      const animation = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in-out', fill: 'forwards' });
      state.animation = animation;
      animation.finished.then(() => {
        layer.remove();
        if (state.layer === layer) state.layer = state.animation = null;
      }, () => { /* A newer theme transition owns the visible frame. */ });
    });
    applyTheme();
    map.triggerRepaint();
  });
  map.triggerRepaint();
}
