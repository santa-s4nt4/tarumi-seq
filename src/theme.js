import './theme.css';

const transitions = new WeakMap();
const duration = 900;

// Copy the previous WebGL frame during Mapbox's render event, while its drawing
// buffer is valid. This avoids enabling preserveDrawingBuffer for every frame.
export function fadeMapTheme(map, applyTheme, { stationaryOnly = false } = {}) {
  let state = transitions.get(map);
  if (!state) { state = { revision: 0, layer: null, animation: null }; transitions.set(map, state); }
  const revision = ++state.revision;
  const clear = () => {
    if (state.onMove) { map.off('move', state.onMove); state.onMove = null; }
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
    if (stationaryOnly) {
      // A captured frame can only be blended while its landmarks still
      // coincide with the live map and its labels.
      const origin = map.getCenter(), zoom = map.getZoom(), pitch = map.getPitch(), bearing = map.getBearing();
      state.onMove = () => {
        if (origin.distanceTo(map.getCenter()) > 0.01 || Math.abs(map.getZoom() - zoom) > 0.0001 ||
            Math.abs(map.getPitch() - pitch) > 0.001 || Math.abs(map.getBearing() - bearing) > 0.001) clear();
      };
      map.on('move', state.onMove);
    }
    map.once('render', () => {
      if (revision !== state.revision || state.layer !== layer) return;
      const animation = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-in-out', fill: 'forwards' });
      state.animation = animation;
      animation.finished.then(() => {
        if (state.layer === layer) clear();
      }, () => { /* A newer theme transition owns the visible frame. */ });
    });
    applyTheme();
    map.triggerRepaint();
  });
  map.triggerRepaint();
}
