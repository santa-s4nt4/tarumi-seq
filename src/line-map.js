import { xy } from './geometry.js';
import { overviewPadding } from './menu-motion.js';

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
  const destination = down ? '樽見行き' : '大垣行き';
  button.innerHTML = '<svg viewBox="0 0 42 24" aria-hidden="true"><rect x="2" y="2" width="38" height="17" rx="3"/><path d="M8 6h7v6H8zm12 0h7v6h-7zm12 0h4v6h-4"/><circle cx="10" cy="21" r="2"/><circle cx="32" cy="21" r="2"/></svg><span></span>';
  button.querySelector('span').textContent = destination;
  button.dataset.train = run.train.id;
  button.setAttribute('aria-label', `${destination}の列車を選択`);
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
  const first = stations.find(station => station.order === 9), last = stations.find(station => station.order === 19);
  const section = profile.section(first.s, last.s);
  line(section, 'line-overview-track');
  const labels = stations.map(station => {
    const group = svgElement('g', { 'data-station': station.order }, svg);
    svgElement('circle', { r: 3 }, group);
    const label = svgElement('text', { x: 8, y: 4 }, group);
    label.textContent = station.name;
    const [lon, lat] = profile.coordinateAt(station.s);
    return { group, label, order: station.order, point: xy(lat, lon) };
  });
  const points = section.map(([lon, lat]) => xy(lat, lon)), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const west = Math.min(...xs), east = Math.max(...xs), north = Math.max(...ys), south = Math.min(...ys);
  const gpsMarker = document.createElement('div');
  gpsMarker.className = 'gps-marker'; gpsMarker.setAttribute('aria-label', 'GPS測位位置');
  gpsMarker.setAttribute('role', 'img'); gpsMarker.hidden = true; container.append(gpsMarker);
  let gpsPoint = null;
  const markers = new Map();
  let latest = [], focus = null, mode = 'overview', overview = true, moveTimer;

  function draw() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    const padding = overview ? overviewPadding() : { left:0, right:0, top:0, bottom:0 };
    const center = focus ? xy(focus.latitude, focus.longitude) : [(west + east) / 2, (north + south) / 2];
    const scale = focus ? Math.min(w, h) / (mode === 'bird' ? 7500 : 3500) : Math.min(Math.max(40,w-padding.left-padding.right)/(east-west),Math.max(40,h-padding.top-padding.bottom)/(north-south));
    const left = (w + padding.left - padding.right) / 2 - center[0] * scale;
    const top = (h + padding.top - padding.bottom) / 2 + center[1] * scale;
    paths.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    gpsMarker.hidden = !gpsPoint;
    if (gpsPoint) {
      const [x, y] = xy(gpsPoint.latitude, gpsPoint.longitude);
      gpsMarker.style.left = `${left + x * scale}px`;
      gpsMarker.style.top = `${top - y * scale}px`;
    }
    let previousY = Infinity;
    for (const { group, label, order, point: [x, y] } of labels) {
      group.style.display = overview && order < 9 ? 'none' : '';
      const py = top - y * scale;
      group.style.transform = `translate(${left + x * scale}px, ${py}px)`;
      const nearTrain = overview && latest.some(train => Math.abs(py - (top - xy(train.latitude,train.longitude)[1] * scale + (train.run.train.direction === 'front' ? 18 : -18))) < 28);
      label.setAttribute('x', nearTrain ? -14 : 8); label.setAttribute('text-anchor', nearTrain ? 'end' : 'start');
      const show = overview || [1, 9, 19].includes(order) || Math.abs(py - previousY) > 20;
      label.style.display = show ? '' : 'none';
      if (show) previousY = py;
    }
    for (const { run, longitude, latitude } of latest) {
      const [x, y] = xy(latitude, longitude);
      const marker = markers.get(run);
      const s = profile.project(longitude, latitude).s;
      marker.hidden = overview && (s < first.s - 1 || s > last.s + 1);
      marker.classList.toggle('is-followed', focus?.run === run);
      marker.style.left = `${left + x * scale}px`;
      marker.style.top = `${top - y * scale}px`;
    }
  }

  new ResizeObserver(draw).observe(container);
  return {
    setOverview(value, duration = 0) {
      overview = value; container.dataset.overview = String(value);
      clearTimeout(moveTimer); container.classList.toggle('menu-moving', duration > 0);
      container.style.setProperty('--line-menu-duration', `${duration}ms`);
      moveTimer = setTimeout(() => container.classList.remove('menu-moving'), duration);
    },
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
