import { xy } from './geometry.js';
import { overviewPadding, overviewRightEdge, easeCamera } from './menu-motion.js';
import { placeOverviewLabels } from './overview-labels.js';

const NS = 'http://www.w3.org/2000/svg';
let tooltipId = 0;

function svgElement(tag, attributes, parent) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  parent.append(element);
  return element;
}

export function trainMarkerButton(run, onSelect) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `line-train ${run.train.direction}`;
  const calls = run.train.stops, label = `${run.stops[0].name}発 ${calls[0].departure}–${calls.at(-1).arrival ?? calls.at(-1).departure}`;
  const tooltip = document.createElement('span'); tooltip.className = 'train-tooltip'; tooltip.id = `train-tooltip-${++tooltipId}`;
  tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = label; button.append(tooltip);
  button.dataset.train = run.train.id;
  button.setAttribute('aria-label', `${label}の列車を選択`); button.setAttribute('aria-describedby', tooltip.id);
  const positionTooltip = () => {
    const rect = button.getBoundingClientRect(), width = tooltip.offsetWidth;
    const left = Math.max(8, Math.min(overviewRightEdge(innerWidth) - width, rect.x + rect.width / 2 - width / 2));
    tooltip.style.left = `${left - rect.x}px`;
  };
  button.addEventListener('pointerenter', positionTooltip); button.addEventListener('focus', positionTooltip);
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
  line(river, 'line-overview-river');
  line(section, 'line-overview-track');
  const labels = stations.map(station => {
    const group = svgElement('g', { 'data-station': station.order, class: station.order === 9 || station.order === 19 ? 'section-endpoint' : '' }, svg);
    svgElement('circle', { r: 3 }, group);
    const tickHalf = station.order === 9 || station.order === 19 ? 22 : 14;
    svgElement('line', { class: 'line-station-tick', x1: -tickHalf, x2: tickHalf, y1: 0, y2: 0 }, group);
    const label = svgElement('text', { x: 8, y: 4 }, group);
    svgElement('tspan', { class: 'station-name-jp' }, label).textContent = station.name;
    svgElement('tspan', { class: 'station-romaji', dx: 8 }, label).textContent = station.romaji;
    const [lon, lat] = profile.coordinateAt(station.s);
    return { group, label, tickHalf, order: station.order, point: xy(lat, lon) };
  });
  const labelSizes = new Map();
  document.fonts.ready.then(() => { labelSizes.clear(); draw(); });
  const points = section.map(([lon, lat]) => xy(lat, lon)), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const west = Math.min(...xs), east = Math.max(...xs), north = Math.max(...ys), south = Math.min(...ys);
  const gpsMarker = document.createElement('div');
  gpsMarker.className = 'gps-marker'; gpsMarker.setAttribute('aria-label', 'GPS測位位置');
  gpsMarker.setAttribute('role', 'img'); gpsMarker.hidden = true; container.append(gpsMarker);
  let gpsPoint = null;
  const markers = new Map();
  let latest = [], focus = null, mode = 'overview', overview = true, motion, lastView, frame;

  function draw() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    const padding = overview ? overviewPadding() : { left:0, right:0, top:0, bottom:0 };
    let center = focus ? xy(focus.latitude, focus.longitude) : [(west + east) / 2, (north + south) / 2];
    let scale = focus ? Math.min(w, h) / (mode === 'bird' ? 7500 : 3500) : Math.min(Math.max(40,w-padding.left-padding.right)/(east-west),Math.max(40,h-padding.top-padding.bottom)/(north-south));
    let screenX = (w + padding.left - padding.right) / 2, screenY = (h + padding.top - padding.bottom) / 2;
    if (motion) {
      const progress = Math.min(1, (performance.now() - motion.start) / motion.duration), t = easeCamera(progress), from = motion.from;
      scale = Math.exp(Math.log(from.scale) + (Math.log(scale) - Math.log(from.scale)) * t);
      const centerT = overview ? t : 1 - Math.min(1, from.scale / scale) * (1 - t);
      center = center.map((value, index) => from.center[index] + (value - from.center[index]) * centerT);
      screenX = from.screenX + (screenX - from.screenX) * t; screenY = from.screenY + (screenY - from.screenY) * t;
      if (progress === 1) motion = null;
    }
    lastView = { center, scale, screenX, screenY };
    const left = screenX - center[0] * scale, top = screenY + center[1] * scale;
    paths.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    gpsMarker.hidden = !gpsPoint;
    if (gpsPoint) {
      const [x, y] = xy(gpsPoint.latitude, gpsPoint.longitude);
      gpsMarker.style.left = `${left + x * scale}px`;
      gpsMarker.style.top = `${top - y * scale}px`;
    }
    const rightEdge = overviewRightEdge(w);
    const trainScreens = overview ? latest.filter(train => {
      const s = profile.project(train.longitude, train.latitude).s;
      return s >= first.s - 1 && s <= last.s + 1;
    }).map(train => {
      const button = markers.get(train.run), [x, y] = xy(train.latitude, train.longitude);
      button.classList.remove('is-followed');
      const pointX = left + x * scale, pointY = top - y * scale;
      return { x: pointX - button.offsetWidth / 2, y: pointY - button.offsetHeight / 2,
        width: button.offsetWidth, height: button.offsetHeight };
    }) : [];
    const placements = overview ? placeOverviewLabels(labels.filter(station => station.order >= 9).map(station => {
      if (!labelSizes.has(station)) {
        const box = station.label.getBBox();
        labelSizes.set(station, { width: box.width, height: box.height, centerY: box.y + box.height / 2 });
      }
      const size = labelSizes.get(station);
      return { order: station.order, x: left + station.point[0] * scale, y: top - station.point[1] * scale + size.centerY,
        ...size, leftGap: station.tickHalf + 6, rightGap: station.tickHalf + 6 };
    }), trainScreens, rightEdge) : [];
    let previousY = Infinity;
    for (const { group, label, tickHalf, order, point: [x, y] } of labels) {
      group.style.display = overview && order < 9 ? 'none' : '';
      const py = top - y * scale;
      group.style.transform = `translate(${left + x * scale}px, ${py}px)`;
      const labelLeft = placements.find(label => label.order === order)?.left;
      label.setAttribute('x', overview ? (labelLeft ? -1 : 1) * (tickHalf + 6) : 8); label.setAttribute('text-anchor', labelLeft ? 'end' : 'start');
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

  new ResizeObserver(() => { labelSizes.clear(); draw(); }).observe(container);
  function animate() {
    frame = null;
    if (container.hidden) motion = null;
    if (motion) { draw(); if (motion) frame = requestAnimationFrame(animate); }
  }
  return {
    setOverview(value, duration = 0) {
      overview = value; container.dataset.overview = String(value);
      labelSizes.clear();
      motion = duration && lastView ? { from: lastView, start: performance.now(), duration } : null;
      if (motion && !frame) frame = requestAnimationFrame(animate);
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
