import { xy } from './geometry.js';

const NS = 'http://www.w3.org/2000/svg';

function svgElement(tag, attributes, parent) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  parent.append(element);
  return element;
}

export function trainMarkerButton(run, onSelect) {
  const button = document.createElement('button');
  button.type = 'button';
  const down = run.train.direction === 'front';
  button.className = `line-train ${run.train.direction}`;
  button.textContent = `${down ? '下り' : '上り'} ${run.train.id}`;
  button.setAttribute('aria-label', `${button.textContent}列車を追従`);
  button.addEventListener('click', () => onSelect(run));
  return button;
}

// A local, north-up map. The complete line and train selection are available
// immediately, including on devices that cannot load the terrain map.
export function createLineMap(container, profile, stations, river, onSelect) {
  const svg = svgElement('svg', { 'aria-hidden': 'true' }, container);
  const paths = svgElement('g', {}, svg);
  function line(coords, className) {
    const points = coords.map(([lon, lat]) => {
      const [x, y] = xy(lat, lon);
      return `${x.toFixed(1)},${(-y).toFixed(1)}`;
    });
    svgElement('polyline', { points: points.join(' '), class: className, fill: 'none', 'vector-effect': 'non-scaling-stroke' }, paths);
  }
  line(river, 'line-river');
  line(profile.railway.coordinates, 'line-track');
  const labels = stations.map(station => {
    const group = svgElement('g', {}, svg);
    svgElement('circle', { r: 3 }, group);
    const label = svgElement('text', { x: 8, y: 4 }, group);
    label.textContent = station.name;
    const [lon, lat] = profile.coordinateAt(station.s);
    return { group, label, order: station.order, point: xy(lat, lon) };
  });
  const xs = profile.track.map(p => p.x), ys = profile.track.map(p => p.y);
  const west = Math.min(...xs), east = Math.max(...xs), north = Math.max(...ys), south = Math.min(...ys);
  const gpsMarker = document.createElement('div');
  gpsMarker.className = 'gps-marker'; gpsMarker.setAttribute('aria-label', 'GPS測位位置');
  gpsMarker.setAttribute('role', 'img'); gpsMarker.hidden = true; container.append(gpsMarker);
  let gpsPoint = null;
  const markers = new Map();
  let latest = [], focus = null, mode = 'overview';

  function draw() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    const center = focus ? xy(focus.latitude, focus.longitude) : [(west + east) / 2, (north + south) / 2];
    const scale = focus ? Math.min(w, h) / (mode === 'bird' ? 7500 : 3500) : Math.min((w - 130) / (east - west), (h - 95) / (north - south));
    const left = w / 2 - center[0] * scale;
    const top = (focus && w <= 600 ? h * 0.36 : h / 2 + 14) + center[1] * scale;
    paths.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    gpsMarker.hidden = !gpsPoint;
    if (gpsPoint) {
      const [x, y] = xy(gpsPoint.latitude, gpsPoint.longitude);
      gpsMarker.style.left = `${left + x * scale}px`;
      gpsMarker.style.top = `${top - y * scale}px`;
    }
    let previousY = Infinity;
    for (const { group, label, order, point: [x, y] } of labels) {
      const py = top - y * scale;
      group.style.transform = `translate(${left + x * scale}px, ${py}px)`;
      const show = [1, 9, 19].includes(order) || Math.abs(py - previousY) > 20;
      label.style.display = show ? '' : 'none';
      if (show) previousY = py;
    }
    for (const { run, longitude, latitude } of latest) {
      const [x, y] = xy(latitude, longitude);
      const marker = markers.get(run);
      marker.style.left = `${left + x * scale}px`;
      marker.style.top = `${top - y * scale}px`;
    }
  }

  new ResizeObserver(draw).observe(container);
  return {
    update(trains, selected, view, point) {
      gpsPoint = point;
      mode = view;
      latest = trains;
      focus = selected;
      for (const [run, marker] of markers) {
        if (!trains.some(train => train.run === run)) { marker.remove(); markers.delete(run); }
      }
      for (const { run } of trains) {
        if (markers.has(run)) continue;
        const button = trainMarkerButton(run, onSelect);
        container.append(button);
        markers.set(run, button);
      }
      draw();
      container.classList.add('positioned');
    },
  };
}
