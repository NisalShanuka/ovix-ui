import type { Point } from '@/generated/zod';

export interface PlaceGroup {
  lat: number;
  lon: number;
  city: string;
  country: string;
  countryCode: string;
  points: Point[];
}

export function placeKey(p: { lat: number; lon: number }): string {
  return `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
}

// Clients the database puts on the same spot share one pin; the busiest spot first.
export function groupByPlace(points: readonly Point[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const p of points) {
    const key = placeKey(p);
    const g = groups.get(key);
    if (g) g.points.push(p);
    else
      groups.set(key, {
        lat: p.lat,
        lon: p.lon,
        city: p.city,
        country: p.country,
        countryCode: p.countryCode,
        points: [p],
      });
  }
  return [...groups.values()].sort(
    (a, b) => b.points.length - a.points.length || a.country.localeCompare(b.country),
  );
}

export interface CountryCount {
  code: string;
  name: string;
  clients: number;
}

// Distinct clients per country, so one client on two phones counts once.
export function countByCountry(points: readonly Point[]): CountryCount[] {
  const byCode = new Map<string, { name: string; emails: Set<string> }>();
  for (const p of points) {
    const entry = byCode.get(p.countryCode) ?? { name: p.country, emails: new Set<string>() };
    entry.emails.add(p.email);
    byCode.set(p.countryCode, entry);
  }
  return [...byCode.entries()]
    .map(([code, e]) => ({ code, name: e.name, clients: e.emails.size }))
    .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
}
