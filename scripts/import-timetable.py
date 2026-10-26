"""Extract the Motosu–Tarumi simulation and full-line reference timetables.
Usage: python3 scripts/import-timetable.py /path/to/source.pdf (requires pdfplumber).
The row/column layout is deliberately tied to this published revision.
"""
import json
import re
import sys
from pathlib import Path
import pdfplumber

root = Path(__file__).resolve().parents[1]
with pdfplumber.open(sys.argv[1]) as pdf:
    words = pdf.pages[0].extract_words()

def row(top):
    return [word for word in words if abs(word['top'] - top) < 0.5 and 235 < word['x0'] < 1009]

def time_at(top, x):
    matches = [word['text'] for word in row(top)
               if abs((word['x0'] + word['x1']) / 2 - x) < 12 and re.fullmatch(r'\d{1,2}:\d{2}', word['text'])]
    if len(matches) > 1:
        raise ValueError('Overlapping timetable columns')
    return matches[0].zfill(5) if matches else None

trains = []
reference_trains = []
for direction, header_top, station_min, station_max, motosu_arrival, motosu_departure in [
    ('front', 87.3, 102, 410, 229.1, 244.9),
    ('back', 452.8, 467, 770, 626.1, 641.8),
]:
    headers = [word for word in words if abs(word['top'] - header_top) < 0.7 and word['x0'] > 235 and re.fullmatch(r'※?\d+', word['text'])]
    assert len(headers) == 22, (direction, len(headers))
    station_rows = [(int(word['text'][2:]), word['top']) for word in words
                    if re.fullmatch(r'TR\d{2}', word['text']) and station_min < word['top'] < station_max]
    assert len(station_rows) == 19
    for header in headers:
        train_id = header['text'].replace('※', '')
        x = (header['x0'] + header['x1']) / 2
        stops = []
        for station, top in station_rows:
            arrival = time_at(motosu_arrival, x) if station == 9 else None
            departure = time_at(motosu_departure if station == 9 else top, x)
            if station == (19 if direction == 'front' else 1):
                arrival, departure = departure, None
            if arrival or departure:
                stops.append({'station': station, 'arrival': arrival, 'departure': departure})
        full_train = {'id': train_id, 'direction': direction, 'operatingDays': 'holiday' if train_id in ['1001', '1002'] else 'daily', 'stops': stops}
        if train_id in ['21', '23']:
            full_train['transferStation'] = 9
            full_train['note'] = '本巣駅で乗り換え'
        assert len(stops) >= 2, train_id
        full_times = [int(value[:2]) * 60 + int(value[3:]) for stop in stops for value in [stop['arrival'], stop['departure']] if value]
        assert full_times == sorted(full_times), (train_id, full_times)
        reference_trains.append(full_train)
        stops = [dict(stop) for stop in stops if 9 <= stop['station'] <= 19]
        if len(stops) < 2:
            continue
        # Motosu is the end of the simulated section for up trains, even when
        # the published service continues south toward Ogaki.
        if direction == 'back':
            assert stops[-1]['station'] == 9 and stops[-1]['arrival']
            stops[-1]['departure'] = None
        times = [int(value[:2]) * 60 + int(value[3:]) for stop in stops for value in [stop['arrival'], stop['departure']] if value]
        assert times == sorted(times), (train_id, times)
        train = {'id': train_id, 'direction': direction, 'operatingDays': 'holiday' if train_id in ['1001', '1002'] else 'daily', 'stops': stops}
        if train_id in ['21', '23']:
            train['transferStation'] = 9
            train['note'] = '本巣駅で乗り換え'
        trains.append(train)
output = {'revision': '2024-04-08', 'sourceURL': 'https://tarumi-railway.com/pdf/station_timetable/file/3',
          'title': '樽見鉄道列車時刻表 · 本巣〜樽見',
          'section': {'firstStation': 9, 'lastStation': 19, 'label': '本巣 — 樽見'}, 'trains': trains}
(root / 'public/data/timetable.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(f'Imported {len(trains)} trains / {sum(len(train["stops"]) for train in trains)} station calls')
reference_output = {**output, 'title': '樽見鉄道列車時刻表 · 大垣〜樽見',
                    'section': {'firstStation': 1, 'lastStation': 19, 'label': '大垣 — 樽見'}, 'trains': reference_trains}
(root / 'public/data/timetable-reference.json').write_text(json.dumps(reference_output, ensure_ascii=False, indent=2) + '\n')
print(f'Imported {len(reference_trains)} full-line reference trains / {sum(len(train["stops"]) for train in reference_trains)} station calls')
