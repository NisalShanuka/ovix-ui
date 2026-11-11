import './brand-mark.css';

// The OVIX STORE VPN mark from vpn.ovix.store: an orange shield and the
// wordmark, until the owner supplies a logo file.
export function ShieldMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      className="ov-shield"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="currentColor" />
      <path d="M12 2v20c4.6-1.6 8-6 8-11V5l-8-3Z" fill="#000" opacity=".18" />
    </svg>
  );
}

export function BrandMark({ compact = false, caption }: { compact?: boolean; caption?: string }) {
  return (
    <span className="ov-brand" aria-label="OVIX STORE VPN">
      <ShieldMark />
      {!compact && (
        <span className="ov-brand-text">
          <b>
            OVIX STORE <span>VPN</span>
          </b>
          {caption && <small>{caption}</small>}
        </span>
      )}
    </span>
  );
}
