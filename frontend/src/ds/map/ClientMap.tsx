import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { MapView } from '@/generated/zod';
import { groupByPlace, placeKey } from './groupByPlace';

interface ClientMapProps {
  view: MapView | undefined;
  isDark: boolean;
  focus: string | null;
  serverLabel: string;
}

// Tiles come through the panel (cached, OSM policy-compliant), so the browser
// never talks to a third party and the strict CSP stays as it is.
const TILE_URL = `${window.X_UI_BASE_PATH || '/'}panel/api/ovix/geo/tile/{z}/{x}/{y}`;

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · IP location by <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a>';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function clientIcon(count: number): L.DivIcon {
  return L.divIcon({
    className: 'ovm-pin',
    html: `<span class="ovm-pin-ring"></span><span class="ovm-pin-dot">${count > 1 ? count : ''}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function serverIcon(label: string): L.DivIcon {
  return L.divIcon({
    className: 'ovm-server',
    html: `<span class="ovm-server-box"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="currentColor"/></svg>${escapeHtml(label)}</span>`,
    iconSize: [0, 0],
  });
}

// A gentle arc between two points reads as a connection, not a border line.
function arc(a: L.LatLngExpression, b: L.LatLngExpression, steps = 32): L.LatLng[] {
  const p = L.latLng(a);
  const q = L.latLng(b);
  const mid = L.latLng((p.lat + q.lat) / 2, (p.lng + q.lng) / 2);
  const bend = Math.min(18, p.distanceTo(q) / 400_000);
  const ctrl = L.latLng(mid.lat + bend, mid.lng);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return L.latLng(
      u * u * p.lat + 2 * u * t * ctrl.lat + t * t * q.lat,
      u * u * p.lng + 2 * u * t * ctrl.lng + t * t * q.lng,
    );
  });
}

// Leaflet map of live clients; markers and arcs redraw on each poll, the view
// is fitted once so the owner's own zoom is never taken away.
export default function ClientMap({ view, isDark, focus, serverLabel }: ClientMapProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!elRef.current) return;
    const map = L.map(elRef.current, {
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 2,
      // An IP only places a client at its provider's network, so street zoom would imply false precision.
      maxZoom: 11,
      attributionControl: true,
    }).setView([20, 30], 2);
    map.attributionControl.setPrefix('');
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tilesRef.current?.remove();
    tilesRef.current = L.tileLayer(TILE_URL, {
      maxZoom: 19,
      className: isDark ? 'ovm-tiles is-dark' : 'ovm-tiles',
      attribution: ATTRIBUTION,
    }).addTo(map);
  }, [isDark]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !view) return;
    layer.clearLayers();
    markersRef.current.clear();
    const server = view.server;
    const groups = groupByPlace(view.points);
    const bounds: L.LatLngExpression[] = [];

    for (const g of groups) {
      const at: L.LatLngExpression = [g.lat, g.lon];
      bounds.push(at);
      if (server) {
        L.polyline(arc([server.lat, server.lon], at), {
          className: 'ovm-link',
          interactive: false,
        }).addTo(layer);
      }
      const rows = g.points
        .map((p) => `<li><b>${escapeHtml(p.email)}</b><span>${escapeHtml(p.ip)}</span></li>`)
        .join('');
      const where = [g.city, g.country].filter(Boolean).join(', ');
      const label = `${where || g.countryCode}: ${g.points.map((p) => p.email).join(', ')}`;
      const marker = L.marker(at, { icon: clientIcon(g.points.length), title: label, alt: label })
        .bindPopup(
          `<div class="ovm-pop"><strong>${escapeHtml(where || g.countryCode)}</strong><ul>${rows}</ul></div>`,
          { closeButton: false },
        )
        .addTo(layer);
      markersRef.current.set(placeKey(g), marker);
    }
    if (server) {
      const at: L.LatLngExpression = [server.lat, server.lon];
      bounds.push(at);
      L.marker(at, {
        icon: serverIcon(serverLabel),
        zIndexOffset: 1000,
        interactive: false,
        keyboard: false,
      }).addTo(layer);
    }
    if (!fittedRef.current && bounds.length > 0) {
      fittedRef.current = true;
      if (bounds.length === 1) map.setView(bounds[0], 5);
      else map.fitBounds(L.latLngBounds(bounds), { padding: [48, 48], maxZoom: 6 });
    }
  }, [view, serverLabel]);

  useEffect(() => {
    if (!focus) return;
    const marker = markersRef.current.get(focus);
    const map = mapRef.current;
    if (!marker || !map) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 7), { duration: 0.8 });
    marker.openPopup();
  }, [focus, view]);

  return <div ref={elRef} className="ovm-map" />;
}
