import { useId } from 'react';
import type { ReactNode } from 'react';

import { sparkPoints } from './sparkPoints';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: number;
  decimals?: number;
  unit?: string;
  format?: (value: number) => [string, string];
  note?: ReactNode;
  series: readonly number[];
  accent?: boolean;
  onClick?: () => void;
}

const W = 200;
const H = 40;

export default function StatCard({
  icon,
  label,
  value,
  decimals = 0,
  unit,
  format,
  note,
  series,
  accent = true,
  onClick,
}: StatCardProps) {
  const [text, suffix] = format ? format(value) : [value.toFixed(decimals), unit];
  const gradientId = `ovd-fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const points = sparkPoints(series.length ? series : [0], W, H);
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`ovd-card ovd-stat${onClick ? ' is-action' : ''}`}
      onClick={onClick}
    >
      <span className="ovd-stat-label">
        <span className="ovd-stat-icon">{icon}</span>
        {label}
      </span>
      <span className="ovd-stat-value">
        {text}
        {suffix && <small>{suffix}</small>}
      </span>
      {note && <span className="ovd-stat-note">{note}</span>}
      <svg className="ovd-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {accent && (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--ov-pr)" stopOpacity=".28" />
                <stop offset="1" stopColor="var(--ov-pr)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`M0,${H} L${points.replaceAll(' ', ' L')} L${W},${H}Z`}
              fill={`url(#${gradientId})`}
            />
          </>
        )}
        <polyline
          points={points}
          fill="none"
          stroke={accent ? 'var(--ov-pr)' : 'var(--ov-tx2)'}
          strokeOpacity={accent ? 1 : 0.6}
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Tag>
  );
}
