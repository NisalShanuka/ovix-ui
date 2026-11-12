import { expect, test } from 'vitest';

import { countByCountry, groupByPlace } from '@/ds/map/groupByPlace';
import type { Point } from '@/generated/zod';

function point(
  email: string,
  ip: string,
  city: string,
  cc: string,
  lat: number,
  lon: number,
): Point {
  const country = { LK: 'Sri Lanka', GB: 'United Kingdom' }[cc] ?? cc;
  return { email, ip, lastSeen: 1, lat, lon, city, region: '', country, countryCode: cc };
}

const points = [
  point('kasun', '175.157.1.1', 'Colombo', 'LK', 6.9271, 79.8612),
  point('amal', '175.157.9.9', 'Colombo', 'LK', 6.9271, 79.8612),
  point('kasun', '175.157.2.2', 'Kandy', 'LK', 7.2906, 80.6337),
  point('jo', '81.2.69.1', 'London', 'GB', 51.5142, -0.0931),
];

test('clients at the same spot share one pin, busiest spot first', () => {
  const groups = groupByPlace(points);
  expect(groups.map((g) => [g.city, g.points.map((p) => p.email)])).toEqual([
    ['Colombo', ['kasun', 'amal']],
    ['Kandy', ['kasun']],
    ['London', ['jo']],
  ]);
});

test('a client on two connections in one country counts once there', () => {
  expect(countByCountry(points)).toEqual([
    { code: 'LK', name: 'Sri Lanka', clients: 2 },
    { code: 'GB', name: 'United Kingdom', clients: 1 },
  ]);
});
