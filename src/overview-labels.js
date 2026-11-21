const overlaps = (a, b) => a.x < b.x + b.width + 4 && b.x < a.x + a.width + 4 && a.y < b.y + b.height + 4 && b.y < a.y + a.height + 4;
const overflow = (rect, right) => Math.max(0, 8 - rect.x) + Math.max(0, rect.x + rect.width - right);

// Keep each name at its station's height; use the other side of the railway
// only when a neighbouring name or a train would cover it.
export function placeOverviewLabels(labels, trains, rightEdge) {
  const placed = [];
  for (const label of [...labels].sort((a, b) => b.y - a.y)) {
    const candidates = [false, true].map(left => ({ ...label, left,
      x: left ? label.x - label.leftGap - label.width : label.x + 8, y: label.y - label.height / 2 }));
    const score = rect => overflow(rect, rightEdge) * 1000000 + placed.filter(other => overlaps(rect, other)).length * 10000 +
      trains.filter(train => overlaps(rect, train)).length * 1000 + Number(rect.left);
    placed.push(candidates.sort((a, b) => score(a) - score(b))[0]);
  }
  return placed;
}

export function placeOverviewTrain(train, labels, rightEdge) {
  const candidates = [train, ...labels.flatMap(label => [
    { ...train, x: label.x + label.width + 8 }, { ...train, x: label.x - train.width - 8 },
  ])];
  const score = rect => overflow(rect, rightEdge) * 1000000 + labels.filter(label => overlaps(rect, label)).length * 10000 + Math.abs(rect.x - train.x);
  return candidates.sort((a, b) => score(a) - score(b))[0];
}
