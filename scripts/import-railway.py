"""Prepare the complete Tarumi line from OSM relation 1864491/full XML.
Usage: python3 scripts/import-railway.py /path/to/relation.osm
No network requests are made by this script or the application's build.
"""
import csv, heapq, json, math, sys
from collections import defaultdict
from pathlib import Path
import xml.etree.ElementTree as ET
root = Path(__file__).resolve().parents[1]
osm = ET.parse(sys.argv[1]).getroot()
R, DEG, COS = 6371008.8, math.pi / 180, math.cos(35.57 * math.pi / 180)
def xy(lat, lon): return ((lon - 136.64) * DEG * R * COS, (lat - 35.57) * DEG * R)
def ll(p): return [p[0] / (DEG * R * COS) + 136.64, p[1] / (DEG * R) + 35.57]
def dist(a,b): return math.hypot(b[0]-a[0],b[1]-a[1])
points = {n.attrib['id']: xy(float(n.attrib['lat']),float(n.attrib['lon'])) for n in osm.findall('node')}
graph = defaultdict(list); edges = []
for way in osm.findall('way'):
    tags = {t.attrib['k']:t.attrib['v'] for t in way.findall('tag')}
    if tags.get('railway') != 'rail' or tags.get('service') in ['yard','siding','spur']: continue
    ids = [n.attrib['ref'] for n in way.findall('nd')]
    for a,b in zip(ids,ids[1:]):
        length = dist(points[a],points[b])
        graph[a].append((b,length)); graph[b].append((a,length)); edges.append((a,b))
def projection(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]; length2=dx*dx+dy*dy
    u=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length2)) if length2 else 0
    q=(a[0]+u*dx,a[1]+u*dy)
    return dist(p,q),q
stations = json.loads((root/'public/data/stations.json').read_text())['stations']
for station in stations:
    p=xy(station['lat'],station['lon'])
    offset,q,a,b=min(((*projection(p,points[a],points[b]),a,b) for a,b in edges),key=lambda v:v[0])
    assert offset<100,(station['name'],offset)
    key='station-'+str(station['order']);points[key]=q
    for node in [a,b]:
        graph[key].append((node,dist(q,points[node]))); graph[node].append((key,dist(q,points[node])))
def path(a,b):
    queue=[(0,a)]; costs={a:0}; previous={}
    while queue:
        cost,node=heapq.heappop(queue)
        if cost>costs[node]: continue
        if node==b:
            result=[b]
            while result[-1]!=a:result.append(previous[result[-1]])
            return result[::-1]
        for neighbour,length in graph[node]:
            candidate=cost+length
            if candidate<costs.get(neighbour,math.inf):
                costs[neighbour]=candidate;previous[neighbour]=node;heapq.heappush(queue,(candidate,neighbour))
    raise ValueError(f'Railway is disconnected: {a} -> {b}')
track=[]; calls=[]; s=0
for i,station in enumerate(stations):
    key='station-'+str(station['order'])
    ids=path('station-'+str(stations[i-1]['order']),key)[1:] if i else [key]
    for node in ids:
        if track:
            length=dist(points[node],track[-1][:2])
            if length<0.001:continue
            s+=length
        track.append([*points[node],s])
    lon,lat=ll(points[key]);calls.append({'order':station['order'],'s':s,'lat':lat,'lon':lon})
assert 33000<s<36000,s

def match(lat,lon):
    p=xy(float(lat),float(lon)); best=None
    for a,b in zip(track,track[1:]):
        offset,q=projection(p,a,b)
        candidate=(offset,a[2]+dist(a,q))
        if best is None or offset<best[0]:best=candidate
    assert best[0]<100,best
    return best[1]
with (root/'public/data/tarumi_tunnels.csv').open(encoding='utf-8-sig') as f:
    tunnels=[{'id':'tunnel-'+t['osm_way_id'],'name':t['tunnel_name'] or 'トンネル'+t['sequence'],
              'start':match(t['entry_latitude'],t['entry_longitude']), 'end':match(t['exit_latitude'],t['exit_longitude'])} for t in csv.DictReader(f)]
for t in tunnels:t['start'],t['end']=sorted([t['start'],t['end']])
output={'sourceURL':'https://www.openstreetmap.org/relation/1864491','downloadedAt':'2026-10-11',
        'attribution':'© OpenStreetMap contributors (ODbL)', 'coordinates':[ll(p) for p in track], 'stations':calls,'tunnels':tunnels}
(root/'public/data/railway-route.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':'))+'\n')
print(f'Prepared {len(track)} track points, {len(calls)} stations, {len(tunnels)} tunnels; {s/1000:.2f} km')
