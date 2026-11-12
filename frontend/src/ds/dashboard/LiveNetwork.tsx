import { useEffect, useLayoutEffect, useRef } from 'react';

import { layoutNetwork } from './network';
import type { NetClient, NetInbound, NetLayout, Point } from './network';

interface LiveNetworkProps {
  inbounds: readonly NetInbound[];
  clients: readonly NetClient[];
  serverLabel: string;
  serverSub: string;
  idleLabel: string;
  formatRate: (bytesPerSecond: number) => string;
  themeKey: string;
  ariaLabel: string;
}

interface Packet {
  from: Point;
  to: Point;
  t: number;
  speed: number;
  size: number;
}

const MAX_CLIENTS = 10;
// The map repaints at 30 fps: smooth enough for moving dots at half the CPU of 60 fps.
const PAINT_INTERVAL_MS = 1000 / 30;
const FRAME_60_MS = 1000 / 60;

function mbps(bytesPerSecond: number): number {
  return (bytesPerSecond * 8) / 1_000_000;
}

function bezier(a: Point, b: Point, t: number): Point {
  const mx = (a.x + b.x) / 2;
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * b.y,
  };
}

function readPalette() {
  const s = getComputedStyle(document.body);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    pr: v('--ov-pr') || '#f97316',
    line: v('--ov-line-strong') || 'rgba(0,0,0,.14)',
    tx: v('--ov-tx') || '#111827',
    mu: v('--ov-mu') || '#5f6672',
    ok: v('--ov-ok') || '#047857',
    solid: v('--ov-solid') || '#ffffff',
    display: v('--ov-font-display') || 'sans-serif',
    body: v('--ov-font-body') || 'sans-serif',
    mono: v('--ov-font-mono') || 'monospace',
  };
}

// Canvas map of server → inbound → client; link width and packet rate follow
// each client's live speed. Frames stop while the map is off screen.
export default function LiveNetwork({
  inbounds,
  clients,
  serverLabel,
  serverSub,
  idleLabel,
  formatRate,
  themeKey,
  ariaLabel,
}: LiveNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef({ inbounds, clients, serverLabel, serverSub, idleLabel, formatRate });
  useLayoutEffect(() => {
    dataRef.current = { inbounds, clients, serverLabel, serverSub, idleLabel, formatRate };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const palette = readPalette();
    let width = 0;
    let height = 0;
    let packets: Packet[] = [];
    let frame = 0;
    let lastPaint = 0;
    let onScreen = true;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const curve = (a: Point, b: Point) => {
      const mx = (a.x + b.x) / 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y);
      ctx.stroke();
    };

    const draw = (net: NetLayout) => {
      const d = dataRef.current;
      ctx.clearRect(0, 0, width, height);
      const inboundById = new Map(net.inbounds.map((ib) => [ib.id, ib]));
      const trunkRate = new Map<number, number>();
      for (const c of net.clients)
        trunkRate.set(c.inboundId, (trunkRate.get(c.inboundId) ?? 0) + c.rate);

      for (const ib of net.inbounds) {
        const rate = mbps(trunkRate.get(ib.id) ?? 0);
        ctx.strokeStyle = palette.pr;
        ctx.globalAlpha = 0.16;
        ctx.lineWidth = 6 + Math.min(6, rate / 10);
        curve(net.server, ib);
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        curve(net.server, ib);
      }

      for (const c of net.clients) {
        const ib = inboundById.get(c.inboundId);
        if (!ib) continue;
        const rate = mbps(c.rate);
        ctx.strokeStyle = rate > 0 ? palette.pr : palette.line;
        ctx.globalAlpha = rate > 0 ? 0.55 : 1;
        ctx.lineWidth = rate > 0 ? 1 + Math.min(4, rate / 5) : 1;
        curve(ib, c);
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = palette.pr;
      for (const p of packets) {
        const pt = bezier(p.from, p.to, p.t);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      const s = net.server;
      ctx.fillStyle = palette.solid;
      ctx.strokeStyle = palette.pr;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(s.x - 34, s.y - 26, 68, 52, 14);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = palette.tx;
      ctx.font = `700 13px ${palette.display}`;
      ctx.fillText(d.serverLabel, s.x, s.y + 1, 60);
      ctx.fillStyle = palette.mu;
      ctx.font = `500 10px ${palette.body}`;
      ctx.fillText(d.serverSub, s.x, s.y + 15, 60);

      for (const ib of net.inbounds) {
        const label = net.compact ? ib.label.split(' ').pop() || ib.label : ib.label;
        ctx.font = `600 11px ${palette.mono}`;
        const w = Math.min(net.compact ? 64 : 120, ctx.measureText(label).width + 22);
        ctx.fillStyle = palette.solid;
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(ib.x - w / 2, ib.y - 14, w, 28, 14);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = palette.tx;
        ctx.fillText(label, ib.x, ib.y + 4, w - 12);
      }

      ctx.textAlign = 'left';
      for (const c of net.clients) {
        const rate = mbps(c.rate);
        const r = rate > 0 ? 6 + Math.min(6, rate / 3) : 5;
        ctx.fillStyle = palette.solid;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = palette.ok;
        ctx.globalAlpha = rate > 0 ? 1 : 0.55;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        const room = width - (c.x + r + 8) - 4;
        ctx.fillStyle = palette.tx;
        ctx.font = `600 12px ${palette.body}`;
        ctx.fillText(c.email, c.x + r + 8, c.y - 1, room);
        ctx.fillStyle = palette.mu;
        ctx.font = `500 11px ${palette.mono}`;
        ctx.fillText(c.rate > 0 ? d.formatRate(c.rate) : d.idleLabel, c.x + r + 8, c.y + 13, room);
      }
    };

    // `steps` is how many 60 fps frames passed, so motion keeps its speed at the lower paint rate.
    const spawn = (net: NetLayout, steps: number) => {
      const inboundById = new Map(net.inbounds.map((ib) => [ib.id, ib]));
      for (const c of net.clients) {
        const rate = mbps(c.rate);
        const ib = inboundById.get(c.inboundId);
        if (!ib || rate <= 0) continue;
        if (Math.random() < Math.min(0.9, (0.02 + rate / 90) * steps)) {
          packets.push({
            from: ib,
            to: c,
            t: 0,
            speed: 0.006 + Math.min(0.02, rate / 1800),
            size: 2.4,
          });
          if (Math.random() < 0.5)
            packets.push({ from: net.server, to: ib, t: 0, speed: 0.02, size: 3 });
        }
      }
      packets = packets.filter((p) => (p.t += p.speed * steps) < 1).slice(-240);
    };

    const paint = (steps: number) => {
      if (width === 0) return;
      const d = dataRef.current;
      const net = layoutNetwork(width, height, d.inbounds, d.clients, MAX_CLIENTS);
      if (steps > 0) spawn(net, steps);
      draw(net);
    };

    const tick = (now = performance.now()) => {
      frame = 0;
      if (!onScreen || document.hidden) return;
      if (reduce) return paint(0);
      if (now - lastPaint >= PAINT_INTERVAL_MS - 2) {
        paint(lastPaint ? Math.min(4, (now - lastPaint) / FRAME_60_MS) : 1);
        lastPaint = now;
      }
      frame = requestAnimationFrame(tick);
    };

    resize();
    // Resizing clears the bitmap, so repaint at once instead of waiting a frame.
    const ro = new ResizeObserver(() => {
      resize();
      paint(0);
      if (!frame) tick();
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen && !frame) tick();
    });
    io.observe(canvas);
    const onVisibility = () => {
      if (!document.hidden && !frame) tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const redraw = reduce ? window.setInterval(() => paint(0), 2000) : 0;
    paint(0);
    tick();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (redraw) window.clearInterval(redraw);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [themeKey]);

  return <canvas ref={canvasRef} className="ovd-net" role="img" aria-label={ariaLabel} />;
}
