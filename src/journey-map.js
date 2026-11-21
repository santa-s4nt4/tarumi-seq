import * as mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { elevatedLineFeature, railLineZOffsetWithClearance, createLineProgress } from './rail-elevation.js';
import { JourneyCamera, cameraEye } from './journey-camera.js';
import { createLineMap, trainMarkerButton } from './line-map.js';
import { fadeMapTheme } from './theme.js';
import { overviewPadding, overviewRightEdge, easeCamera } from './menu-motion.js';
import { placeOverviewLabels } from './overview-labels.js';
import { turnTowards } from './camera.js';

const collection = features => ({ type: 'FeatureCollection', features: features.filter(Boolean) });
export function createJourneyMap({ profile, stations, river, onSelect, onError = () => {} }) {
  const fallback = document.getElementById('line-map');
  const line = createLineMap(fallback, profile, stations, river, onSelect);
  const camera = new JourneyCamera();
  const progressAt = createLineProgress(profile), mapElement = document.getElementById('map');
  const first = stations.find(station => station.order === 9), last = stations.find(station => station.order === 19);
  const section = profile.section(first.s, last.s);
  let map, ready = false, overview = true, latest, dark = false, previousTime, marker, lastS, lastTheme;
  let lastProgress, lastStations = -Infinity, mapHeight = 1, visibleHeight = 1, lastDirection;
  const heights = new WeakMap();
  const labelSizes = new Map();
  document.fonts.ready.then(() => labelSizes.clear());
  const stationMarkers = [], tunnelMarkers = [], trainMarkers = new Map();
  let fleet = [], gpsMarker, layoutKey, returning;
  function fit(duration = 0) {
    if (!ready) return;
    map.stop();
    const bounds = new mapboxgl.LngLatBounds();
    for (const point of section) bounds.extend(point);
    map.fitBounds(bounds, { padding: overviewPadding(), pitch: 0, bearing: 0, duration, easing: easeCamera });
  }
  function theme() {
    if (!ready) return;
    map.setConfigProperty('basemap', 'lightPreset', dark ? 'night' : 'day');
    for (const key of ['colorLand', 'colorGreenspace', 'colorCommercial', 'colorEducation', 'colorMedical', 'colorIndustrial']) {
      map.setConfigProperty('basemap', key, dark ? '#18231b' : '#c4c1b0');
    }
    map.setConfigProperty('basemap', 'colorWater', overview ? '#c4dce8' : '#0a84ff');
    map.setPaintProperty('contours', 'line-color', dark ? '#bfffcc' : '#56655b');
  }
  function terrainHeight(lon, lat) { return map.queryTerrainElevation([lon, lat], { exaggerated: false }); }
  function altitude(m, s) {
    const location = m.getLngLat(), ground = terrainHeight(location.lng, location.lat);
    const value = profile.elevationAt(s) + 1 - ground;
    if (Number.isFinite(ground) && Math.abs(value - (heights.get(m) ?? Infinity)) > 0.001) {
      m.setAltitude(value); heights.set(m, value);
    }
  }
  function sizeOverview() {
    const width = parseFloat(getComputedStyle(mapElement).getPropertyValue('--overview-line-width'));
    for (const id of ['overview-route', 'overview-river']) {
      if (map.getPaintProperty(id, 'line-width') !== width) map.setPaintProperty(id, 'line-width', width);
    }
    for (const station of stationMarkers) {
      const element = station.marker.getElement();
      if (!element.hidden) station.marker.setOffset([-element.querySelector('.station-tick').offsetWidth / 2, 0]);
    }
  }
  function overviewLayers() {
    labelSizes.clear();
    mapElement.dataset.overview = String(overview);
    if (!ready) return;
    for (const id of ['route', 'travelled', 'river', 'bridges', 'tunnels', 'tunnel-halo']) map.setLayoutProperty(id, 'visibility', overview ? 'none' : 'visible');
    map.setLayoutProperty('overview-route', 'visibility', overview ? 'visible' : 'none');
    map.setLayoutProperty('overview-river', 'visibility', overview ? 'visible' : 'none');
    for (const station of stationMarkers) {
      station.marker.getElement().hidden = overview && station.order < 9;
      if (overview) { station.marker.setAltitude(0); heights.delete(station.marker); }
      else station.marker.setOffset([-14, 0]);
    }
    if (overview) sizeOverview();
    if (overview) for (const portal of tunnelMarkers) portal.marker.getElement().hidden = true;
    theme();
  }
  function animate(now) {
    requestAnimationFrame(animate);
    const elapsed = previousTime ? Math.min(80, now - previousTime) : 16; previousTime = now;
    if (!ready || overview || !latest || document.hidden) return;
    const p = latest.position;
    if (lastS !== undefined && Math.abs(p.s - lastS) > 200) camera.reset();
    const moved = p.s !== lastS;
    const view = camera.at({ profile, s: p.s, direction: latest.direction, height: visibleHeight,
      sampleElevation: terrainHeight, now, elapsed });
    // A temporarily taller drawing buffer is clipped around the visible map.
    // Preserve its apparent zoom while the timeline changes the visible height.
    view.radius *= mapHeight / visibleHeight;
    const eye = cameraEye(view, view.radius);
    const free = map.getFreeCameraOptions();
    const target = mapboxgl.MercatorCoordinate.fromLngLat([eye.longitude, eye.latitude], eye.altitude);
    if (returning && now < returning.end) {
      const t = easeCamera(1 - (returning.end - now) / returning.duration);
      const focus = mapboxgl.MercatorCoordinate.fromLngLat(view.center, view.elevation + 1), from = returning.focus;
      const targetRadius = view.radius * focus.meterInMercatorCoordinateUnits() / mapHeight;
      const radiusPerPixel = Math.exp(Math.log(returning.radiusPerPixel) + (Math.log(targetRadius) - Math.log(returning.radiusPerPixel)) * t);
      const radius = radiusPerPixel * mapHeight;
      // Reduce the remaining offset with the viewing distance, keeping the
      // train in frame instead of sweeping sideways at the end of the zoom.
      const centerT = 1 - Math.min(1, radiusPerPixel / returning.radiusPerPixel) * (1 - t);
      const pitch = returning.pitch + (view.pitch - returning.pitch) * t, bearing = turnTowards(returning.bearing, view.bearing, t);
      const horizontal = radius * Math.sin(pitch * Math.PI / 180);
      const position = new mapboxgl.MercatorCoordinate(from.x + (focus.x - from.x) * centerT - Math.sin(bearing * Math.PI / 180) * horizontal,
        from.y + (focus.y - from.y) * centerT + Math.cos(bearing * Math.PI / 180) * horizontal,
        from.z + (focus.z - from.z) * centerT + radius * Math.cos(pitch * Math.PI / 180));
      const ll = position.toLngLat(), ground = terrainHeight(ll.lng, ll.lat);
      if (Number.isFinite(ground) && position.toAltitude() < ground + 20) position.z = mapboxgl.MercatorCoordinate.fromLngLat(ll, ground + 20).z;
      map.setPadding(Object.fromEntries(Object.entries(returning.padding).map(([key, value]) => [key, value * (1 - t)])));
      free.position = position; free.setPitchBearing(pitch, bearing);
    } else {
      if (returning) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      returning = null; free.position = target; free.setPitchBearing(view.pitch, view.bearing);
    }
    // Terrain tile loading can adjust Mapbox's camera even while paused.
    // Reapply the intended pose to keep the rail position at the centre.
    map.setFreeCameraOptions(free);
    marker.getElement().classList.toggle('tracking-center', !returning);
    // Both the camera and marker target the track altitude, not the mountain's
    // surface. This prevents the train drifting upward as ground height changes.
    if (moved) marker.setLngLat(view.center);
    altitude(marker, p.s);
    if (marker.getElement().hidden) marker.getElement().hidden = false;
    const mode = camera.targetBird ? 'bird' : 'normal';
    if (mapElement.dataset.camera !== mode) { mapElement.dataset.camera = mode; mapElement.dataset.zoom = (camera.targetBird ? 19 : 20).toString(); }
    if (lastDirection !== latest.direction) {
      for (const portal of tunnelMarkers) {
        const entrance = portal.start === (latest.direction === 'front'), element = portal.marker.getElement();
        element.classList.toggle('exit', !entrance); element.classList.toggle('entrance', entrance);
        element.dataset.target = entrance ? 'entrance' : 'exit';
        element.setAttribute('aria-label', `${portal.name} ${entrance ? '入口' : '出口'}`);
        element.querySelector('.tunnel-marker-label').hidden = !entrance;
        portal.marker.setOffset([entrance ? -14 : -10, 0]);
      }
      lastDirection = latest.direction;
    }
    if (now - lastStations >= 250) {
      for (const station of stationMarkers) {
        const element = station.marker.getElement(), hidden = Math.abs(station.s - p.s) > 2200;
        if (element.hidden !== hidden) element.hidden = hidden;
        element.classList.toggle('next-station', station.name === latest.next?.station?.name);
        if (!hidden) altitude(station.marker, station.s);
      }
      for (const portal of tunnelMarkers) {
        const element = portal.marker.getElement(), hidden = Math.abs(portal.s - p.s) > 1600;
        if (element.hidden !== hidden) element.hidden = hidden;
      }
      lastStations = now;
    }
    if (moved || lastProgress === undefined) {
      const progress = progressAt(p.s);
      // Trim the untravelled portion of the shared, immutable line source.
      // https://docs.mapbox.com/style-spec/reference/layers/#line-trim-offset
      map.setPaintProperty('travelled', 'line-trim-offset', latest.direction === 'front' ? [progress, 1] : [0, progress]);
      lastProgress = progress;
    }
    lastS = p.s;
  }
  function showFleet() {
    if (!ready) return;
    for (const [run, item] of trainMarkers) if (!overview || !fleet.some(item => item.run === run)) { item.remove(); trainMarkers.delete(run); }
    if (!overview) return;
    const trainScreens = [];
    for (const { run, longitude, latitude } of fleet) {
      const s = profile.project(longitude, latitude).s;
      if (s < first.s - 1 || s > last.s + 1) { trainMarkers.get(run)?.remove(); trainMarkers.delete(run); continue; }
      let item = trainMarkers.get(run);
      if (!item) {
        const button = trainMarkerButton(run, onSelect); button.className = `overview-train ${run.train.direction}`;
        item = new mapboxgl.Marker({ element: button, anchor: 'center' })
          .setLngLat([longitude, latitude]).addTo(map); trainMarkers.set(run, item);
      } else item.setLngLat([longitude, latitude]);
      const point = map.project([longitude, latitude]);
      const button = item.getElement();
      trainScreens.push({ x: point.x - button.offsetWidth / 2, y: point.y - button.offsetHeight / 2, width: button.offsetWidth, height: button.offsetHeight });
    }
    const rightEdge = overviewRightEdge(mapElement.clientWidth);
    const labels = placeOverviewLabels(stationMarkers.filter(station => station.order >= 9).map(station => {
      const element = station.marker.getElement(), point = map.project(profile.coordinateAt(station.s));
      if (!labelSizes.has(station)) {
        const name = element.querySelector('.station-marker-name');
        labelSizes.set(station, { width: name.offsetWidth, height: name.offsetHeight });
      }
      const gap = element.querySelector('.station-tick').offsetWidth / 2 + 6;
      return { element, ...point, ...labelSizes.get(station), leftGap: gap, rightGap: gap };
    }), trainScreens, rightEdge);
    for (const label of labels) label.element.classList.toggle('overview-label-left', label.left);
  }
  try {
    const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!accessToken) throw new Error('地図のアクセストークンが未設定です');
    map = new mapboxgl.Map({ container: 'map', accessToken, center: [136.64, 35.5], zoom: 10, projection: 'mercator', interactive: false, maxPitch: 80,
      style: 'mapbox://styles/mapbox/standard', attributionControl: { compact: true, customAttribution: '路線・駅・河川 © OpenStreetMap contributors · 駅周辺標高: 国土地理院の標高データを加工' },
      config: { basemap: { theme: 'monochrome', show3dObjects: false, showPlaceLabels: false, showPointOfInterestLabels: false, showTransitLabels: false, showRoadLabels: false } } });
    map.on('load', () => {
      ready = true; fallback.hidden = true; mapHeight = map.getCanvas().clientHeight;
      map.addSource('dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
      // Use metres consistently for terrain, rail/bridge lines and the camera.
      map.setTerrain({ source: 'dem', exaggeration: 1 });
      map.addSource('topography', { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' });
      map.addLayer({ id: 'contours', type: 'line', slot: 'middle', source: 'topography', 'source-layer': 'contour', paint: { 'line-color': '#56655b', 'line-opacity': 0.45, 'line-width': 0.6, 'line-emissive-strength': 1 } });
      map.addSource('river', { type: 'geojson', data: collection([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: river } }]) });
      map.addLayer({ id: 'river', type: 'line', slot: 'top', source: 'river', paint: { 'line-color': '#0a84ff', 'line-width': 6, 'line-emissive-strength': 1 } });
      map.addLayer({ id: 'overview-river', type: 'line', slot: 'top', source: 'river',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#75bee5', 'line-opacity': 0.55, 'line-width': 6, 'line-emissive-strength': 1 } });
      const geometry = {
        route: collection([elevatedLineFeature(profile, profile.railway.coordinates)]), travelled: null,
        bridges: collection(profile.railway.bridges.map(item => elevatedLineFeature(profile, profile.section(item.start, item.end)))),
        tunnels: collection(profile.railway.tunnels.map(item => elevatedLineFeature(profile, profile.section(item.start, item.end)))),
      };
      for (const [id, data] of Object.entries(geometry)) {
        if (data) map.addSource(id, { type: 'geojson', data, lineMetrics: true });
        if (id === 'tunnels') map.addLayer({ id: 'tunnel-halo', type: 'line', slot: 'top', source: 'tunnels',
          layout: { 'line-cap': 'round', 'line-join': 'round', 'line-elevation-reference': 'sea', 'line-z-offset': railLineZOffsetWithClearance(1), 'line-elevation-ground-scale': 1 },
          paint: { 'line-color': '#331e19', 'line-width': 18, 'line-emissive-strength': 1, 'line-occlusion-opacity': 0.1 } });
        map.addLayer({ id, type: 'line', slot: 'top', source: id === 'travelled' ? 'route' : id, layout: { 'line-elevation-reference': 'sea',
          'line-z-offset': railLineZOffsetWithClearance(id === 'bridges' ? 1.5 : 1), 'line-elevation-ground-scale': 1 },
        paint: { 'line-color': id === 'bridges' ? '#6e3f22' : id === 'travelled' ? '#bfffcc' : '#00ff36',
          'line-width': id === 'bridges' ? 8 : id === 'tunnels' ? 13 : 5, 'line-emissive-strength': 1, 'line-occlusion-opacity': 0.25,
          ...(id === 'travelled' ? { 'line-trim-offset': [0, 1] } : {}),
          ...(id === 'tunnels' ? { 'line-dasharray': [0.7, 0.7] } : {}) } });
      }
      map.addSource('overview-route', { type: 'geojson', data: collection([{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:section}}]) });
      map.addLayer({ id:'overview-route',type:'line',slot:'top',source:'overview-route',paint:{'line-color':'#00ff36','line-width':6,'line-emissive-strength':1} });
      const element = document.createElement('div'); element.className = 'current-marker'; element.innerHTML = '<span></span>';
      element.setAttribute('aria-label', '列車の現在地'); element.hidden = true;
      marker = new mapboxgl.Marker({ element, occludedOpacity: 0.25 }).setLngLat(profile.coordinateAt(0)).addTo(map);
      for (const station of stations) {
        const element = document.createElement('div'); element.className = 'station-marker';
        element.dataset.station = station.order;
        element.classList.toggle('section-endpoint', station.order === 9 || station.order === 19);
        const tick = document.createElement('span'); tick.className = 'station-tick'; tick.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.className = 'station-marker-name'; label.textContent = station.name;
        const roman = document.createElement('small'); roman.className = 'station-romaji'; roman.textContent = station.romaji;
        label.append(roman);
        element.append(tick, label);
        stationMarkers.push({ ...station, marker: new mapboxgl.Marker({ element, anchor: 'left', offset: [-14, 0], occludedOpacity: 0.2 })
          .setLngLat(profile.coordinateAt(station.s)).addTo(map) });
      }
      for (const tunnel of profile.railway.tunnels) for (const start of [true, false]) {
        const s = start ? tunnel.start : tunnel.end, element = document.createElement('div');
        element.className = 'tunnel-marker'; element.hidden = true; element.dataset.tunnel = tunnel.id;
        element.innerHTML = '<span class="tunnel-portal">∩</span><span class="tunnel-marker-label"></span>';
        element.querySelector('.tunnel-marker-label').textContent = tunnel.name;
        tunnelMarkers.push({ s, start, name: tunnel.name, marker: new mapboxgl.Marker({ element, anchor: 'bottom-left', offset: [-14, 0], occludedOpacity: 0.2 })
          .setLngLat(profile.coordinateAt(s)).addTo(map) });
      }
      overviewLayers(); if (overview) fit(); showFleet();
    });
    // DEM detail changes during rendering, independently of the train clock.
    // Keep each visible portal at the same sea-level height as its tunnel line.
    map.on('render', () => {
      if (!ready || overview) return;
      for (const portal of tunnelMarkers) if (!portal.marker.getElement().hidden) altitude(portal.marker, portal.s);
    });
    map.on('error', () => { if (!ready) { fallback.hidden = false; onError(); } });
    new ResizeObserver(([entry]) => {
      labelSizes.clear(); mapHeight = entry.contentRect.height; map.resize();
      if (ready && overview) { sizeOverview(); if (!map.isMoving()) fit(); }
    }).observe(mapElement);
    new ResizeObserver(([entry]) => { visibleHeight = Math.max(1, entry.contentRect.height); }).observe(mapElement.parentElement);
  } catch { fallback.hidden = false; onError(); }
  requestAnimationFrame(animate);
  return {
    setPrediction(prediction) { latest = prediction; },
    update(prediction, trains = [], point = null) {
      latest = prediction; fleet = trains;
      const focus = prediction ? { ...prediction.position, run: trains[0]?.run } : null;
      if (!ready) line.update(trains, overview ? null : focus, camera.mode, point);
      if (ready) {
        showFleet();
        if (point) {
          if (!gpsMarker) { const el = document.createElement('div'); el.className = 'gps-marker'; el.setAttribute('aria-label', 'GPS測位位置');
            gpsMarker = new mapboxgl.Marker({ element: el }).setLngLat([point.longitude, point.latitude]).addTo(map); }
          else gpsMarker.setLngLat([point.longitude, point.latitude]);
        } else { gpsMarker?.remove(); gpsMarker = null; }
      }
    },
    setOverview(value, duration = 0) {
      if (!value && !overview) return;
      const nextLayout = JSON.stringify(overviewPadding());
      if (overview === value && (!value || layoutKey === nextLayout)) return;
      const changed = overview !== value; overview = value; layoutKey = nextLayout; lastS = undefined; lastStations = -Infinity;
      line.setOverview(value, duration); mapElement.dataset.overview = String(value);
      if (!ready) line.update(fleet, !value && latest ? {...latest.position,run:fleet[0]?.run} : null, camera.mode, null);
      if (ready) {
        map.stop(); map.resize(); mapHeight = map.getCanvas().clientHeight;
        if (value) marker.getElement().hidden = true;
        if (value) { returning = null; fit(duration); lastProgress = undefined; }
        else if (changed) {
          const free = map.getFreeCameraOptions(), pitch = map.getPitch(), bearing = map.getBearing();
          const elevation = terrainHeight(map.getCenter().lng, map.getCenter().lat) ?? 0;
          const z = mapboxgl.MercatorCoordinate.fromLngLat(map.getCenter(), elevation + 1).z;
          const radius = Math.max(1e-10, (free.position.z - z) / Math.cos(pitch * Math.PI / 180));
          const horizontal = radius * Math.sin(pitch * Math.PI / 180);
          const focus = { x: free.position.x + Math.sin(bearing * Math.PI / 180) * horizontal,
            y: free.position.y - Math.cos(bearing * Math.PI / 180) * horizontal, z };
          returning = duration ? { focus, radiusPerPixel: radius / mapHeight, padding: map.getPadding(), pitch, bearing, end: performance.now() + duration, duration } : null;
          if (!duration) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        }
        overviewLayers();
        showFleet();
      }
    },
    setMode(mode) { camera.setMode(mode); },
    reset() { camera.reset(); lastS = undefined; lastStations = -Infinity; },
    setDark(value) { dark = value; if (lastTheme === value) return; lastTheme = value; if (ready) { if (overview || returning) theme(); else fadeMapTheme(map, theme); } },
  };
}
