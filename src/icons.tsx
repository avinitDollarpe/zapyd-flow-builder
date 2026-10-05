// Icon paths from Lucide (ISC licence), plus flag and coin badges.
const PATHS: Record<string, string> = {
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  'user-round': '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  'id-card': '<path d="M16 10h2M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  'file-invoice': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8M16 13H8M16 17H8"/>',
  banknote: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  'arrow-down': '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/>',
  'arrow-up': '<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>',
  landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="m12 2 8 5H4z"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  vault: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="12" cy="12" r="2"/><path d="m7.9 7.9 2.7 2.7M13.4 10.6l2.7-2.7M7.9 16.1l2.7-2.7M13.4 13.4l2.7 2.7"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevrons-up-down': '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  swap: '<path d="m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16"/>',
  external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  terminal: '<path d="m7 11 2-2-2-2M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
}

const ISO2: Record<string, string> = {
  BRL: 'br', CNY: 'cn', COP: 'co', EUR: 'eu', HKD: 'hk', INR: 'in', MXN: 'mx',
  NGN: 'ng', PHP: 'ph', SGD: 'sg', AED: 'ae', GBP: 'gb', USD: 'us',
}

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  if (name.startsWith('flag:')) {
    return <img className="flag" src={`/flags/${ISO2[name.slice(5)]}.svg`} width={size} height={size} alt="" />
  }
  if (name.startsWith('coin:')) return <CoinLogo code={name.slice(5)} size={size} />
  if (name.startsWith('net:')) {
    const n = name.slice(4)
    // Arbitrum and BNB ship as round badges; the rest are bare marks on a white tile.
    return (
      <span className={`net-logo${n === 'arbitrum' || n === 'bsc' ? ' badge' : ''}`} style={{ width: size, height: size }}>
        <img src={`/networks/${n}.svg`} alt="" />
      </span>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? '' }}
    />
  )
}

// Two icons in one slot; `on` shows the second. Both stay in the DOM and cross-fade.
export function Swap({ on, a, b, size = 16 }: { on: boolean; a: string; b: string; size?: number }) {
  return (
    <span className={`swap${on ? ' on' : ''}`}>
      <Icon name={a} size={size} />
      <Icon name={b} size={size} />
    </span>
  )
}

export function CoinLogo({ code, size = 16 }: { code: string; size?: number }) {
  if (code === 'USDC')
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#2775CA" />
        <path d="M20.2 18.5c0-2.2-1.3-3-4-3.3-1.9-.3-2.3-.8-2.3-1.7s.7-1.5 1.9-1.5c1.1 0 1.8.4 2.1 1.4.1.2.2.3.4.3h1c.3 0 .4-.2.4-.4-.3-1.4-1.4-2.5-2.9-2.6V9.2c0-.2-.2-.4-.5-.4h-.9c-.2 0-.4.2-.5.4v1.5c-1.9.3-3.1 1.5-3.1 3.1 0 2.1 1.3 2.9 4 3.2 1.8.3 2.4.7 2.4 1.7s-.9 1.7-2.1 1.7c-1.6 0-2.2-.7-2.4-1.6-.1-.2-.2-.3-.4-.3h-1c-.3 0-.4.2-.4.4.3 1.5 1.2 2.5 3.2 2.8v1.5c0 .2.2.4.5.4h.9c.2 0 .4-.2.5-.4v-1.5c1.9-.3 3.2-1.6 3.2-3.2z" fill="#fff" />
        <path d="M12.8 25.1c-5-1.8-7.6-7.3-5.8-12.3 1-2.7 3.1-4.8 5.8-5.8.3-.1.4-.3.4-.6v-.9c0-.2-.1-.4-.4-.5h-.1C6.6 6.9 3.1 13.1 5 19.1c1.1 3.6 3.9 6.4 7.5 7.5.2.1.5 0 .5-.2v-1c0-.1-.1-.3-.2-.3zM19.2 5.1c-.2-.1-.5 0-.5.2v.9c0 .3.1.5.4.6 5 1.8 7.6 7.3 5.8 12.3-1 2.7-3.1 4.8-5.8 5.8-.3.1-.4.3-.4.6v.9c0 .2.1.4.4.5h.1c6-1.9 9.3-8.2 7.4-14.2-1.1-3.7-3.9-6.5-7.4-7.6z" fill="#fff" />
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#26A17B" />
      <path d="M17.9 17.1v0c-.1 0-.7.1-1.9.1-1 0-1.7 0-1.9-.1v0c-3.7-.2-6.5-.8-6.5-1.6s2.8-1.4 6.5-1.6v2.5c.2 0 .9.1 1.9.1 1.2 0 1.8-.1 1.9-.1v-2.5c3.7.2 6.4.8 6.4 1.6s-2.7 1.4-6.4 1.6zm0-3.4v-2.3h5.2V8H8.9v3.4h5.2v2.3c-4.2.2-7.4 1-7.4 2.1s3.2 1.9 7.4 2.1v7.3h3.8v-7.3c4.2-.2 7.4-1 7.4-2.1s-3.2-1.9-7.4-2.1z" fill="#fff" />
    </svg>
  )
}
