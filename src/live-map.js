import * as mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { elevatedLineFeature, railLineZOffsetWithClearance } from './rail-elevation.js';
import { xy } from './geometry.js';
import { fadeMapTheme } from './theme.js';

const collection = features => ({ type: 'FeatureCollection', features: features.filter(Boolean) });

export function createLiveMap({ profile, river, stations, onError }) {
  let map, ready = false, marker, latest = null, mode = 'follow', dark = false;
  const stationMarkers = [];
  const mobileMapLabels = matchMedia('(max-width: 600px)');
  function theme() {
    if (!ready) return;
    map.setConfigProperty('basemap', 'lightPreset', dark ? 'night' : 'day');
    for (const key of ['colorLand', 'colorGreenspace', 'colorCommercial', 'colorEducation', 'colorMedical', 'colorIndustrial']) map.setConfigProperty('basemap', key, dark ? '#18231b' : '#c4c1b0');
    map.setConfigProperty('basemap', 'colorWater', '#0a84ff');
    map.setPaintProperty('contours', 'line-color', dark ? '#bfffcc' : '#1d3a22');
  }
  function fit() {
    const bounds = new mapboxgl.LngLatBounds();
    for (const point of profile.railway.coordinates) bounds.extend(point);
    map.fitBounds(bounds, { padding: 70, pitch: 0, bearing: 0, duration: 500 });
  }
  function update() {
    if (!ready || !latest) return;
    const p = latest.position;
    const location = [p.longitude, p.latitude];
    const ground = map.queryTerrainElevation(location, { exaggerated: true });
    marker.setLngLat(location);
    if (Number.isFinite(ground)) marker.setAltitude(profile.elevationAt(p.s) * 1.5 - ground);
    marker.getElement().hidden = false;
    const sign = latest.direction === 'front' ? 1 : -1;
    const ahead = profile.coordinateAt(p.s + sign * 100);
    const a = xy(p.latitude, p.longitude), b = xy(ahead[1], ahead[0]);
    const bearing = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    if (mode !== 'overview') map.easeTo({ center: location, zoom: mode === 'bird' ? 16 : 16.5, pitch: mode === 'bird' ? 0 : 55, bearing, duration: 550 });
    for (const item of stationMarkers) {
      item.marker.getElement().hidden = Math.abs(item.s - p.s) > 2200;
      item.marker.getElement().classList.toggle('next-station', item.name === latest.next.station?.name);
    }
  }
  function padding() {
    if (!ready) return;
    const container = map.getContainer(), canvas = map.getCanvas();
    if (canvas.clientHeight !== container.clientHeight || canvas.clientWidth !== container.clientWidth) map.resize();
    const mobile = matchMedia('(max-width: 600px)').matches && !document.body.classList.contains('countdown-mode');
    const bottom = mobile ? Math.min(document.querySelector('.cue-overlay').offsetHeight + 28, container.clientHeight * 0.55) : 0;
    map.setPadding({ top: mobile ? 80 : 0, bottom, left: 0, right: 0 });
    update();
  }
  try {
    const accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
    if (!accessToken) throw new Error('地図のアクセストークンが未設定です。');
    map = new mapboxgl.Map({ container: 'map', accessToken, center: [136.65, 35.56], zoom: 11, interactive: false,
      attributionControl: { compact: true, customAttribution: '路線・駅・トンネル © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · 駅周辺標高: 国土地理院の標高データを加工' },
      style: 'mapbox://styles/mapbox/standard', config: { basemap: { theme: 'monochrome', show3dObjects: false, showPlaceLabels: !mobileMapLabels.matches, showPointOfInterestLabels: false, showTransitLabels: false, showRoadLabels: false } } });
    mobileMapLabels.addEventListener('change', () => {
      if (ready) map.setConfigProperty('basemap', 'showPlaceLabels', !mobileMapLabels.matches);
    });
    map.on('load', () => {
      ready = true;
      map.addSource('dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 });
      map.setTerrain({ source: 'dem', exaggeration: 1.5 });
      map.addSource('topography', { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' });
      map.addLayer({ id: 'contours', type: 'line', slot: 'middle', source: 'topography', 'source-layer': 'contour', paint: { 'line-color': '#1d3a22', 'line-opacity': 0.3, 'line-width': 0.6, 'line-emissive-strength': 1 } });
      const geometry = {
        route: collection([elevatedLineFeature(profile, profile.railway.coordinates)]),
        tunnels: collection(profile.railway.tunnels.map(item => elevatedLineFeature(profile, profile.section(item.start, item.end)))),
        bridges: collection(profile.railway.bridges.map(item => elevatedLineFeature(profile, profile.section(item.start, item.end)))),
      };
      map.addSource('river', { type: 'geojson', data: collection([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: river } }]) });
      map.addLayer({ id: 'river', type: 'line', slot: 'top', source: 'river', paint: { 'line-color': '#0a84ff', 'line-width': 9, 'line-emissive-strength': 1 } });
      for (const [id, data] of Object.entries(geometry)) {
        map.addSource(id, { type: 'geojson', data, lineMetrics: true });
        const clearance = id === 'route' ? 1 : id === 'tunnels' ? 2.5 : 4;
        map.addLayer({ id, type: 'line', slot: 'top', source: id, layout: { 'line-elevation-reference': 'sea', 'line-z-offset': railLineZOffsetWithClearance(clearance), 'line-elevation-ground-scale': 1 },
          paint: { 'line-color': id === 'bridges' ? '#331e19' : '#00ff36', 'line-width': id === 'tunnels' ? 10 : 7, 'line-emissive-strength': 1, 'line-occlusion-opacity': 0.3,
            ...(id === 'tunnels' ? { 'line-dasharray': [0.7, 0.7] } : {}) } });
      }
      const element = document.createElement('div'); element.className = 'current-marker'; element.innerHTML = '<span></span>'; element.hidden = true; element.setAttribute('aria-label', 'スマートフォンの現在地');
      marker = new mapboxgl.Marker({ element, occludedOpacity: 0.3 }).setLngLat([136.65, 35.56]).addTo(map);
      for (const station of stations) {
        const element = document.createElement('div'); element.className = 'station-marker';
        element.innerHTML = '<span class="station-tick"></span><span class="station-marker-name"></span>';
        element.querySelector('.station-marker-name').textContent = station.name;
        stationMarkers.push({ ...station, marker: new mapboxgl.Marker({ element, anchor: 'left', offset: [-14, 0], occludedOpacity: 0.3 }).setLngLat(profile.coordinateAt(station.s)).addTo(map) });
      }
      theme(); padding(); if (latest) update(); else fit();
    });
    map.on('error', () => onError('地図を読み込めません。通信状態を確認してください。GPSの合図判定は継続します。'));
    const observer = new ResizeObserver(padding);
    observer.observe(document.querySelector('.map-panel'));
    observer.observe(document.querySelector('.cue-overlay'));
  } catch (error) { onError(`${error.message} GPSの合図判定は利用できます。`); }
  return {
    update(prediction) { latest = prediction; marker?.getElement().classList.remove('live-location-stale'); update(); },
    stale() { marker?.getElement().classList.add('live-location-stale'); },
    setMode(value) { mode = value; if (!ready) return; if (mode === 'overview') fit(); else update(); },
    setDark(value) { if (dark === value) return; dark = value; if (ready) fadeMapTheme(map, theme); },
  };
}
