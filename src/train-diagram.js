// Each horizontal row is a station. Stops use the same arrival/departure
// clocks as the cues, including dwells and estimated intermediate arrivals.
export function createTrainDiagram(svg, stations, onTrain) {
  function add(tag, attrs, parent = svg) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    parent.append(el);
    return el;
  }
  const grid = add('g', {}), lines = add('g', {});
  const highlight = add('polyline', { class: 'diagram-section', 'pointer-events': 'none' });
  let plans, selection, drawnPlans, drawnWidth;
  function render() {
    const width = svg.clientWidth;
    if (!plans || !width) return;
    const left = 32, right = width - 6, top = 10, bottom = 118;
    const x = seconds => left + (seconds / 3600 - 5) / 19 * (right - left);
    const y = order => bottom - (order - stations[0].order) / (stations.at(-1).order - stations[0].order) * (bottom - top);
    function points(stops) {
      return stops.flatMap((stop, index) => {
        const times = [stop.arrivalSeconds];
        if (index < stops.length - 1) times.push(stop.departureSeconds);
        return times.map(time => `${x(time)},${y(stop.station)}`);
      }).join(' ');
    }
    if (width !== drawnWidth) {
      svg.setAttribute('viewBox', `0 0 ${width} 142`);
      grid.replaceChildren();
      for (const station of stations) {
        const row = y(station.order);
        add('line', { x1: left, x2: right, y1: row, y2: row }, grid);
        if ([1, 9, 19].includes(station.order)) add('text', { x: left - 4, y: row + 4, 'text-anchor': 'end' }, grid).textContent = station.name;
      }
      for (let hour = 6; hour < 24; hour += 3) {
        const col = x(hour * 3600);
        add('line', { x1: col, x2: col, y1: top, y2: bottom }, grid);
        add('text', { x: col, y: 135, 'text-anchor': 'middle' }, grid).textContent = `${hour}時`;
      }
    }
    if (width !== drawnWidth || plans !== drawnPlans) {
      lines.replaceChildren();
      for (const plan of plans) {
        const group = add('g', { 'data-train': plan.train.id }, lines);
        const path = points(plan.stops);
        add('polyline', { points: path, class: 'diagram-service' }, group);
        const target = add('polyline', { points: path, class: 'diagram-hit' }, group);
        add('title', {}, target).textContent = `${plan.train.id}列車`;
        target.addEventListener('click', () => onTrain(plan.train.id));
      }
      drawnPlans = plans;
      drawnWidth = width;
    }
    for (const group of lines.children) group.classList.toggle('selected', group.dataset.train === selection.train.id);
    highlight.setAttribute('points', points(selection.stops));
  }
  new ResizeObserver(render).observe(svg);
  return (available, selected) => { plans = available; selection = selected; render(); };
}
