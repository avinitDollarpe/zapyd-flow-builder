// Shared data, state and components for the rates page. Rates and history come from the public rates API (RATES_URL).
(() => {
const Z = window.Z = {}

// ── Markets. Methods (rate, fee, speed, limit and history each) come from the rate card API; a placeholder until it loads
const M = (key, name, cur, region, flag, lat, lon, extra = {}) => ({ key, name, cur, region, flag, lat, lon, mid: 0, dp: 2,
  methods: [{ key: key + 0, name: '–', rate: '', fee: '–', speed: '–', limit: '–', mid: 0, dp: 2 }], ...extra })
Z.MARKETS = [
  M('IN', 'India', 'INR', 'Asia Pacific', 'in', 22, 79),
  M('CN', 'China', 'CNY', 'Asia Pacific', 'cn', 33, 104),
  M('HK', 'Hong Kong', 'HKD', 'Asia Pacific', 'hk', 22.3, 114.2),
  M('PK', 'Pakistan', 'PKR', 'Asia Pacific', 'pk', 30, 69.3),
  M('BD', 'Bangladesh', 'BDT', 'Asia Pacific', 'bd', 23.7, 90.4),
  M('ID', 'Indonesia', 'IDR', 'Asia Pacific', 'id', -2.5, 118),
  M('TH', 'Thailand', 'THB', 'Asia Pacific', 'th', 15.5, 101),
  M('MY', 'Malaysia', 'MYR', 'Asia Pacific', 'my', 4.2, 102),
  M('SG', 'Singapore', 'SGD', 'Asia Pacific', 'sg', 1.35, 103.8),
  M('VN', 'Vietnam', 'VND', 'Asia Pacific', 'vn', 14, 108.3),
  M('JP', 'Japan', 'JPY', 'Asia Pacific', 'jp', 36.5, 138.5),
  M('PH', 'Philippines', 'PHP', 'Asia Pacific', 'ph', 12.5, 122),
  M('EU', 'Euro area', 'EUR', 'Europe', 'eu', 51, 10.5, { note: '20 countries' }),
  M('GB', 'United Kingdom', 'GBP', 'Europe', 'gb', 53, -1.5),
  M('US', 'United States', 'USD', 'Americas', 'us', 39, -98, { payin: true }),
  M('MX', 'Mexico', 'MXN', 'Americas', 'mx', 23.5, -102),
  M('BR', 'Brazil', 'BRL', 'Americas', 'br', -10, -52),
  M('CO', 'Colombia', 'COP', 'Americas', 'co', 4, -73),
  M('AE', 'UAE', 'AED', 'Middle East', 'ae', 23.9, 54.5),
  M('NG', 'Nigeria', 'NGN', 'Africa', 'ng', 9, 8),
  M('KE', 'Kenya', 'KES', 'Africa', 'ke', 0.2, 37.9),
  M('UG', 'Uganda', 'UGX', 'Africa', 'ug', 1.4, 32.3),
  M('TZ', 'Tanzania', 'TZS', 'Africa', 'tz', -6.4, 34.9),
]
Z.BY = Object.fromEntries(Z.MARKETS.map(m => [m.key, m]))
Z.REGIONS = ['Asia Pacific', 'Europe', 'Americas', 'Middle East', 'Africa']
// Payin: USD in the USA, credited in stablecoins at 1:1 less the volume tier. Tiers ([bps, volume]) and deposit fees come from the payin card API
Z.TIERS = []
Z.DEPOSITS = []
Z.ASSETS = { USDC: { key: 'USDC', mid: 1 }, USDT: { key: 'USDT', mid: 1 } }
// Map filters: what each one lights up
Z.FILTERS = [
  { v: 'all', label: 'All supported', has: () => true },
  { v: 'payin', label: 'Payin', has: m => m.payin },
  { v: 'payout', label: 'Payout', has: () => true },
  { v: 'both', label: 'Payin and payout', has: m => m.payin },
]
Z.RANGES = { '24H': 864e5, '7D': 6048e5, '30D': 2592e6 }   // span in ms
Z.REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

Z.state = { flow: 'payout', sel: 'IN', meth: 0, tier: 10, asset: 'USDC', range: '30D', hover: null, filter: 'all', status: 'loading', updated: 0 }
const subs = []
Z.sub = f => subs.push(f)
Z.pub = (type, data = {}) => subs.forEach(f => f(type, data))
const set = (type, patch) => { Object.assign(Z.state, patch); Z.pub(type) }
Z.select = k => { if (!Z.BY[k]) return; history.replaceState(null, '', location.search + '#c=' + k); set('select', { sel: k, meth: 0 }) }
Z.setFlow = f => f !== Z.state.flow && set('flow', { flow: f })
Z.setMeth = i => set('meth', { meth: i })
Z.setTier = b => set('tier', { tier: b })
Z.setAsset = a => set('asset', { asset: a })
Z.setRange = r => set('range', { range: r })
Z.setFilter = f => f !== Z.state.filter && set('filter', { filter: f })
Z.setHover = k => k !== Z.state.hover && set('hover', { hover: k })
Z.cur = () => Z.BY[Z.state.sel]
Z.curMeth = () => Z.cur().methods[Z.state.meth]
Z.filterDef = () => Z.FILTERS.find(f => f.v === Z.state.filter)

// ── Rates API, public on the orchestrator. Payout (Nova): the rate card, per currency its methods, each with its rate and
// history in buckets per range (15 min for 24H up to 6 hours for 30D), every range ending on the live rate. Payin (Nebula): tiers and deposit fees.
// On localhost it reads a local orchestrator (port 8003, as in e2e-local), like the docs read this app on localhost:5180; ?api= picks any host
const API = new URLSearchParams(location.search).get('api') || (location.hostname === 'localhost' ? 'http://localhost:8003' : 'https://api.zapyd.com')
const hist = {}, fetched = new Set()   // method key + range -> { t, v }; market key + range already loaded
const load = async (range, cur = '') => {
  const res = await fetch(`${API}/pos/api/v1/payout/rates?range=${range}${cur && '&fiat=' + cur}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  for (const g of (await res.json()).data) {
    const m = Z.MARKETS.find(x => x.cur === g.fiat)
    if (!m) continue
    fetched.add(m.key + range)
    // VND comes with 6 decimals (25808.166000): cut to 2, no rounding. Every other currency shows the API's decimals
    const cut = s => g.fiat === 'VND' ? s.replace(/(\.\d{2})\d+$/, '$1') : s
    const methods = g.methods.map((x, i) => {
      const key = m.key + i, pts = x.points.map(([t, r]) => [t, cut(r)]), last = pts.at(-1)
      if (pts.length) hist[key + range] = { t: pts.map(p => p[0]), v: pts.map(p => +p[1]) }
      if (last) Z.state.updated = Math.max(Z.state.updated, last[0])
      return { key, name: x.method, rate: x.rate, fee: x.fee, speed: x.speed, limit: x.limit,
        mid: last ? +last[1] : 0, dp: last ? last[1].split('.')[1]?.length ?? 0 : 2 }   // the live rate
    })
    if (range === '24H') { m.methods = methods; m.mid = methods[0].mid; m.dp = methods[0].dp }
  }
}
// Once: the payin card
fetch(`${API}/pis/api/v1/payin/rates`).then(r => r.json()).then(({ data }) => {
  Z.TIERS = data.tiers.map(t => [+t.bps, t.volume]); Z.DEPOSITS = data.deposit_methods.map(d => [d.method, d.fee]); Z.pub('tier')
}, () => {})
// Every minute: today's rates for every market. Live once a rate has loaded.
Z.refresh = async () => {
  try { await load('24H'); Z.state.failed = false } catch { Z.state.failed = true }   // keep the last rates; the status says how old they are
  const s = Z.state.updated ? 'live' : 'loading'
  if (s !== Z.state.status) Z.setStatus(s)
  Z.pub('tick', { key: Z.view().key })
}
// A longer range loads for the chosen market when it's first shown
const loadRange = () => {
  const m = Z.cur(), r = Z.state.range
  if (r === '24H' || fetched.has(m.key + r) || !Z.state.updated) return
  load(r, m.cur).then(() => Z.pub('tick', { key: m.key }), () => {})
}
Z.sub(t => ['select', 'range', 'status'].includes(t) && loadRange())
// The last point is always today's rate. Until a range has two points (and for payin, 1:1 by definition) the line is flat.
// x is a payout method or a payin asset (key, mid)
Z.series = (x, range) => {
  const s = hist[x.key + range], now = Date.now()
  return s?.v.length > 1 ? { t: s.t, v: [...s.v.slice(0, -1), x.mid] } : { t: [now - Z.RANGES[range], now], v: [x.mid, x.mid] }
}
Z.change = (x, range = '24H') => { const v = Z.series(x, range).v; return v[v.length - 1] / v[0] - 1 || 0 }
Z.payinRate = () => Z.ASSETS[Z.state.asset].mid * (1 - Z.state.tier / 1e4)

// What the chart and the rate checker show for the current selection: Zapyd's price only
Z.view = () => {
  const s = Z.state
  if (s.flow === 'payin') {
    const a = Z.ASSETS[s.asset], k = 1 - s.tier / 1e4, tier = Z.TIERS.find(t => t[0] === s.tier)
    return { flow: 'payin', key: a.key, m: Z.BY.US, base: 'USD', quote: s.asset, dp: 4, rate: a.mid * k, change: Z.change(a),
      name: `${tier?.[1] ?? '–'} a month`, model: `1:1 less ${s.tier} bps`, modelClass: 'model', series: r => { const x = Z.series(a, r); return { t: x.t, v: x.v.map(v => v * k) } } }
  }
  const m = Z.cur(), meth = Z.curMeth()
  return { flow: 'payout', key: m.key, m, meth, base: 'USDC', quote: m.cur, dp: meth.dp, rate: meth.mid, change: Z.change(meth),
    name: meth.name, model: meth.rate, modelClass: meth.rate === 'Live rate' ? 'model is-live' : 'model', speed: meth.speed,
    fee: meth.fee === '-' ? 'None' : meth.fee, series: r => Z.series(meth, r) }
}

// ── Format ──
Z.fmt = (v, dp) => v ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : '–'   // – until a rate loads
Z.sig = v => v >= 100 ? Z.fmt(v, 2) : v >= 1 ? Z.fmt(v, 4) : v.toPrecision(4)
Z.flagUrl = m => `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${m.flag}.svg`
Z.flag = (m, cls = '') => `<img class="flag ${cls}" src="${Z.flagUrl(m)}" alt="" loading="lazy">`
const ARROW_UP = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 8H1z" fill="currentColor"/></svg>'
const ARROW_DOWN = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5 1 2h8z" fill="currentColor"/></svg>'
Z.delta = v => `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? ARROW_UP : ARROW_DOWN}${Math.abs(v * 100).toFixed(2)}%<span class="sr"> ${v >= 0 ? 'up' : 'down'}</span></span>`
Z.icon = {
  swap: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
}
Z.logo = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="23" viewBox="0 0 371.9 95.62" role="img" aria-label="Zapyd"><path fill="currentColor" d="M157.71,32.56,134.35,63h18.06a4.68,4.68,0,0,1,4.68,4.67v7.12H114.92V67l23.36-30.39H121.45a4.67,4.67,0,0,1-4.67-4.67V24.81h40.93Z"/><path fill="currentColor" d="M197.3,24.81v4.75a17.73,17.73,0,0,0-4.85-3.62,20.93,20.93,0,0,0-9.62-2.17,22.74,22.74,0,0,0-12.3,3.42,23.76,23.76,0,0,0-8.58,9.3,28.15,28.15,0,0,0-3.1,13.33A28,28,0,0,0,162,63.06a23.83,23.83,0,0,0,8.58,9.3,22.82,22.82,0,0,0,12.3,3.41,20.46,20.46,0,0,0,9.62-2.22,18.13,18.13,0,0,0,4.85-3.65v.17A4.67,4.67,0,0,0,202,74.74h8.77V24.81Zm-2.79,34.68a12,12,0,0,1-9.2,3.77,12.55,12.55,0,0,1-6.56-1.7,11.88,11.88,0,0,1-4.45-4.76,15,15,0,0,1-1.6-7.08,14.78,14.78,0,0,1,1.6-7A11.79,11.79,0,0,1,178.75,38a12.46,12.46,0,0,1,6.56-1.71A12.71,12.71,0,0,1,192,38a11.79,11.79,0,0,1,4.45,4.75,14.9,14.9,0,0,1,1.6,7A13.74,13.74,0,0,1,194.51,59.49Z"/><path fill="currentColor" d="M267.75,36.49a24.11,24.11,0,0,0-8.63-9.3,22.93,22.93,0,0,0-12.4-3.42,20.27,20.27,0,0,0-9.67,2.28,19.15,19.15,0,0,0-4.49,3.24V24.81H219V95.62h8.76A4.68,4.68,0,0,0,232.45,91V70.32A18.79,18.79,0,0,0,237,73.55a21,21,0,0,0,9.72,2.22,23,23,0,0,0,12.4-3.41,24.18,24.18,0,0,0,8.63-9.3,27.53,27.53,0,0,0,3.16-13.24A27.72,27.72,0,0,0,267.75,36.49ZM255.45,56.8A11.84,11.84,0,0,1,251,61.56a12.87,12.87,0,0,1-6.62,1.7,12.55,12.55,0,0,1-6.56-1.7,11.88,11.88,0,0,1-4.45-4.76,15,15,0,0,1-1.6-7.08,14.78,14.78,0,0,1,1.6-7,11.71,11.71,0,0,1,4.5-4.75,12.56,12.56,0,0,1,6.51-1.71A12.78,12.78,0,0,1,251,38a11.75,11.75,0,0,1,4.49,4.75,14.78,14.78,0,0,1,1.6,7A15,15,0,0,1,255.45,56.8Z"/><path fill="currentColor" d="M322.18,24.81,300,75.15l-7.87,17.69a4.67,4.67,0,0,1-4.27,2.78H276.49l11.9-25.17L269.46,24.81h14.68L295.56,56.5,307.4,24.81Z"/><path fill="currentColor" d="M358.36,4.67V29.12a18.64,18.64,0,0,0-4.5-3.18,21.18,21.18,0,0,0-9.66-2.17,22.87,22.87,0,0,0-12.46,3.42,24.21,24.21,0,0,0-8.58,9.3A27.83,27.83,0,0,0,320,49.82a27.64,27.64,0,0,0,3.15,13.24,24.18,24.18,0,0,0,8.63,9.3,23,23,0,0,0,12.41,3.41,20.73,20.73,0,0,0,9.72-2.27,18.7,18.7,0,0,0,4.54-3.3v4.54H371.9V0H363A4.67,4.67,0,0,0,358.36,4.67Zm-.77,52.13a11.88,11.88,0,0,1-4.45,4.76,12.8,12.8,0,0,1-6.67,1.7,12.65,12.65,0,0,1-6.51-1.7,11.8,11.8,0,0,1-4.5-4.76,15,15,0,0,1-1.6-7.08,14.47,14.47,0,0,1,1.6-6.93,12.13,12.13,0,0,1,11.12-6.51A12.48,12.48,0,0,1,353.14,38a11.79,11.79,0,0,1,4.45,4.75,14.9,14.9,0,0,1,1.6,7A15.09,15.09,0,0,1,357.59,56.8Z"/><path fill="#063EFF" d="M72.88,20.78,60.72,37.32a19.33,19.33,0,0,1-15.61,7.44H2.2c-1.74,0-2.79-1.67-1.85-2.95L12.51,25.27a19.36,19.36,0,0,1,15.61-7.44H71C72.77,17.83,73.82,19.51,72.88,20.78Z"/><path fill="#063EFF" d="M76.74,56.81,64.58,73.35A19.34,19.34,0,0,1,49,80.79H6.06c-1.74,0-2.79-1.68-1.85-3L16.37,61.3A19.33,19.33,0,0,1,32,53.86H74.89C76.63,53.86,77.68,55.53,76.74,56.81Z"/></svg>`

// ── Theme, status, boot ──
Z.setTheme = t => {
  const off = document.createElement('style')
  off.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.append(off)
  document.documentElement.dataset.theme = t
  void document.body.offsetHeight
  requestAnimationFrame(() => requestAnimationFrame(() => off.remove()))
  Z.pub('theme')
}
Z.setStatus = s => { const from = Z.state.status; Z.state.status = s; document.body.dataset.state = s; Z.pub('status', { from }) }
Z.boot = ({ theme = null } = {}) => {
  const qs = new URLSearchParams(location.search)
  if (qs.has('embed')) document.documentElement.dataset.embed = ''
  const h = new URLSearchParams(location.hash.slice(1)).get('c')?.toUpperCase()
  if (h && Z.BY[h]) Z.state.sel = h
  // Deep links: ?flow=payin&filter=payout&range=7D
  if (qs.get('flow') === 'payin') Z.state.flow = 'payin'
  if (Z.FILTERS.some(f => f.v === qs.get('filter'))) Z.state.filter = qs.get('filter')
  if (Z.RANGES[qs.get('range')]) Z.state.range = qs.get('range')
  // Light by default; only the theme toggle (or the docs' theme message, or ?theme=) switches to dark
  document.documentElement.dataset.theme = qs.get('theme') ?? theme ?? 'light'
  document.body.dataset.state = Z.state.status
  addEventListener('message', e => { if (e.data?.type === 'zapyd:theme') Z.setTheme(e.data.theme) })
  Z.refresh(); setInterval(Z.refresh, 6e4)
}
// ── Component: theme toggle. Both icons stay in the DOM and cross-fade (opacity, scale 0.25 → 1, blur 4px → 0) ──
Z.themeToggle = el => {
  el.className = 'theme-toggle'; el.type = 'button'
  el.innerHTML = `<svg class="theme-toggle__sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    <svg class="theme-toggle__moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11Z"/></svg>`
  const sync = () => { const dark = document.documentElement.dataset.theme === 'dark'; el.setAttribute('aria-pressed', dark); el.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode') }
  el.addEventListener('click', () => Z.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'))
  Z.sub(t => t === 'theme' && sync()); sync()
}

// ── Component: live pill ──
Z.livePill = el => {
  el.className = 'live'; el.setAttribute('role', 'status')
  el.innerHTML = '<span class="live__dot"></span><span></span>'
  const t = el.lastChild
  const draw = () => {
    const s = Math.round((Date.now() - Z.state.updated) / 1000)
    t.textContent = Z.state.status === 'loading' ? (Z.state.failed ? "Couldn't load rates · retrying every minute" : 'Loading rates…') : `Live · updated ${s < 2 ? 'just now' : s < 60 ? s + 's ago' : Math.round(s / 60) + ' min ago'}`
  }
  setInterval(draw, 1000); Z.sub(draw); draw()
}

// ── Shared intro timing, taken from the reference dashboard ──
// A dot appears at 595 ms + its column's share of a 1,050 ms left-to-right sweep + a per-dot hash of up to 245 ms,
// shows the flash colour for 90 ms, then settles. The intro ends at 1,990 ms. Chart lines draw in over 770 ms.
const START = 595, SWEEP = 1050, JITTER = 245, FLASH = 90, SETTLE = 200, INTRO = START + SWEEP + JITTER + 100, LINE = 770
const fract = v => v - Math.floor(v)
const hash = (a, b) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453)
const delayOf = (fx, a, b) => START + fx * SWEEP + hash(a, b) * JITTER
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]

// Start an intro the first time an element is on screen
function whenVisible(el, fn) {
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn() } }, { threshold: .25 })
  io.observe(el)
}
// Square, pixel-snapped dots, as in the reference renderer
const square = (p, x, y, s) => { const X = Math.round(x), Y = Math.round(y); p.rect(X, Y, Math.max(1, Math.round(x + s) - X), Math.max(1, Math.round(y + s) - Y)) }

// ── Component: dot map ──
// One pass of the reference sweep: each dot appears, flashes, and settles to its final colour.
// Hovering a market draws its exact outline over the dots.
const DOTS = window.DOTS
document.documentElement.style.setProperty('--map-aspect', `${DOTS.w} / ${DOTS.h}`)
document.documentElement.style.setProperty('--map-ratio', DOTS.w / DOTS.h)
const KEY = Object.fromEntries([...DOTS.keys].map((c, i) => [c, DOTS.ids[i]]))
const DOT_LIST = []
DOTS.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== ' ') DOT_LIST.push({ x, y, k: KEY[c] ?? null, delay: delayOf(x / DOTS.w, x, y) }) }))
const DOT_COUNT = DOT_LIST.reduce((n, d) => (d.k && (n[d.k] = (n[d.k] ?? 0) + 1), n), {})
const DOT = .65, LIT_IN = 250
Z.toXY = m => ({ x: (m.lon - DOTS.lon0) / DOTS.step, y: (DOTS.lat0 - m.lat) / DOTS.step })
const OUTLINE = Object.fromEntries(Object.entries(DOTS.outlines).map(([k, rings]) => {
  const p = new Path2D()
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) { const x = (r[i] - DOTS.lon0) / DOTS.step, y = (DOTS.lat0 - r[i + 1]) / DOTS.step; if (i) p.lineTo(x, y); else p.moveTo(x, y) }
    p.closePath()
  }
  return [k, p]
}))
// Bounds of each market's main landmass, for placing the hover card beside it
const BOUNDS = {}
for (const m of Z.MARKETS) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const r of DOTS.outlines[m.key] ?? []) {
    let near = false
    for (let i = 0; i < r.length; i += 2) if (Math.abs(r[i] - m.lon) < 20 && Math.abs(r[i + 1] - m.lat) < 20) { near = true; break }
    if (!near) continue
    for (let i = 0; i < r.length; i += 2) { const gx = (r[i] - DOTS.lon0) / DOTS.step, gy = (DOTS.lat0 - r[i + 1]) / DOTS.step; x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); y0 = Math.min(y0, gy); y1 = Math.max(y1, gy) }
  }
  const c = Z.toXY(m)
  BOUNDS[m.key] = x0 < Infinity ? { x0, x1 } : { x0: c.x - 1, x1: c.x + 1 }
}
// Bounds in map columns, for placing panels beside a country
Z.bounds = k => BOUNDS[k]
// Every other country: one path for the thin grey lines, plus each country's own path, overall bounds (to skip
// hit tests early) and main-landmass bounds (to place the hover card), for hover and request-access clicks
const BORDERS = new Path2D()
const OTHERS = DOTS.borders.map(b => {
  const path = new Path2D()
  let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity, main = null, big = -1
  for (const r of b.r) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < r.length; i += 2) {
      const x = (r[i] - DOTS.lon0) / DOTS.step, y = (DOTS.lat0 - r[i + 1]) / DOTS.step
      if (i) { path.lineTo(x, y); BORDERS.lineTo(x, y) } else { path.moveTo(x, y); BORDERS.moveTo(x, y) }
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    path.closePath(); BORDERS.closePath()
    X0 = Math.min(X0, x0); X1 = Math.max(X1, x1); Y0 = Math.min(Y0, y0); Y1 = Math.max(Y1, y1)
    if ((x1 - x0) * (y1 - y0) > big) { big = (x1 - x0) * (y1 - y0); main = { x0, x1, y0, y1 } }
  }
  return { name: b.n, iso: b.c, path, box: { x0: X0, x1: X1, y0: Y0, y1: Y1 }, main }
})
const hitCtx = document.createElement('canvas').getContext('2d')
const lit = (k, filter) => !!k && Z.FILTERS.find(f => f.v === filter).has(Z.BY[k])
// Only a hovered market is highlighted; nothing is pre-selected on the map
const focusOf = filter => Z.state.hover && lit(Z.state.hover, filter) ? Z.state.hover : null

Z.map = (el, opts = {}) => {
  const o = { label: 'World map of Zapyd markets', ...opts }
  el.classList.add('world')
  el.innerHTML = `<canvas role="img" aria-label="${o.label}"></canvas>` +
    '<div class="world__hover"><span class="world__link"><span class="world__link-v"></span><span class="world__link-h"></span></span><span class="marker"></span><div class="tip" role="status" aria-live="polite"></div></div>'
  const canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d')
  const [hov, link, marker, tip] = ['.world__hover', '.world__link', '.marker', '.tip'].map(s => el.querySelector(s))
  let colors = {}, t0 = null, raf = 0, focusKey = null, focusAt = 0, started = false, lines = null, other = null, otherAt = 0
  const rims = {}
  const readColors = () => {
    const cs = getComputedStyle(document.documentElement)
    for (const k of ['track', 'land', 'pay', 'flash', 'hi', 'line', 'fill', 'border', 'other-line', 'other-fill']) colors[k] = cs.getPropertyValue('--map-' + k).trim()
    colors.dot = parseFloat(cs.getPropertyValue('--map-dot')) || DOT   // dot size as a share of the grid pitch, per theme
    for (const k in rims) delete rims[k]
    lines = null
  }
  readColors()
  // Outer outline only: stroke at double width, then cut the inside away, so internal borders (the euro area) disappear
  const rim = (id, path, stroke, W, H, cell, dpr) => {
    id = `${id}:${W}`
    if (rims[id]) return rims[id]
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d')
    x.setTransform(cell, 0, 0, cell, 0, 0); x.lineJoin = 'round'; x.lineWidth = 2.5 * dpr / cell
    x.strokeStyle = stroke
    x.stroke(path); x.globalCompositeOperation = 'destination-out'; x.fill(path)
    return rims[id] = c
  }
  // Country lines, cached per size and filter: grey for every country, then the lit markets in their colour
  const countryLines = (W, H, cell, dpr, filter) => {
    const id = `${W}:${filter}`
    if (lines?.id === id) return lines.c
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d')
    x.setTransform(cell, 0, 0, cell, 0, 0); x.lineJoin = 'round'
    x.lineWidth = dpr / cell; x.strokeStyle = colors.border; x.stroke(BORDERS)
    for (const k in OUTLINE) if (!lit(k, filter)) x.stroke(OUTLINE[k])
    x.lineWidth = 1.25 * dpr / cell
    for (const k in OUTLINE) if (lit(k, filter)) { x.strokeStyle = colors.line; x.stroke(OUTLINE[k]) }
    lines = { id, c }
    return c
  }
  const bucket = (d, filter) => !d.k || !lit(d.k, filter) ? 'track' : 'pay'

  function draw() {
    const cw = canvas.getBoundingClientRect().width, dpr = devicePixelRatio || 1
    const W = Math.round(cw * dpr), H = Math.round(W * DOTS.h / DOTS.w)
    if (!W) { raf = 0; return }
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    const cell = W / DOTS.w, size = cell * colors.dot, inset = (cell - size) / 2, now = performance.now()
    const since = t0 === null ? Infinity : now - t0, loading = Z.state.status === 'loading', filter = Z.state.filter
    const focus = loading ? null : focusOf(filter)
    if (focus !== focusKey) { focusKey = focus; focusAt = now }
    const settled = since > INTRO
    let busy = !settled || loading || now - focusAt < LIT_IN || now - otherAt < LIT_IN
    const P = { track: new Path2D(), land: new Path2D(), pay: new Path2D(), hi: new Path2D(), flash: new Path2D() }
    for (const d of DOT_LIST) {
      if (since < d.delay) continue                                   // dots appear from nothing
      let b = loading ? 'land' : since < d.delay + FLASH ? 'flash' : bucket(d, filter)
      if (d.k && d.k === focus && b === 'pay' && settled) b = 'hi'
      square(P[b], d.x * cell + inset, d.y * cell + inset, size)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H)
    ctx.globalAlpha = loading ? .55 + .25 * Math.sin(now / 300) : 1
    const a = settled && focus && OUTLINE[focus] ? Math.min(1, (now - focusAt) / LIT_IN) : 0
    if (a > 0) { ctx.save(); ctx.globalAlpha = a; ctx.setTransform(cell, 0, 0, cell, 0, 0); ctx.fillStyle = colors.fill; ctx.fill(OUTLINE[focus], 'evenodd'); ctx.restore() }
    for (const b of ['track', 'land', 'pay', 'hi', 'flash']) { ctx.fillStyle = colors[b]; ctx.fill(P[b]) }
    // Country lines fade in for 250 ms once the sweep has settled
    const la = loading ? 0 : Math.max(0, Math.min(1, (since - INTRO) / LIT_IN))
    if (la > 0) { ctx.globalAlpha = la; ctx.drawImage(countryLines(W, H, cell, dpr, filter), 0, 0); if (la < 1) busy = true }
    if (a > 0) { ctx.globalAlpha = a; ctx.drawImage(rim(focus, OUTLINE[focus], colors.line, W, H, cell, dpr), 0, 0) }
    // A hovered unsupported country: soft grey tint and outline, so it reads as clickable
    const oa = settled && other && !loading ? Math.min(1, (now - otherAt) / LIT_IN) : 0
    if (oa > 0) {
      ctx.save(); ctx.globalAlpha = oa; ctx.setTransform(cell, 0, 0, cell, 0, 0); ctx.fillStyle = colors['other-fill']; ctx.fill(other.path, 'evenodd'); ctx.restore()
      ctx.globalAlpha = oa; ctx.drawImage(rim('x:' + other.name, other.path, colors['other-line'], W, H, cell, dpr), 0, 0)
    }
    ctx.globalAlpha = 1
    raf = busy ? requestAnimationFrame(draw) : 0
  }
  const kick = () => { if (!raf && started) raf = requestAnimationFrame(draw) }

  // Hover card: header (flag, name, currency chip), body (rate with its 24h change), footer strip (speed, flow, action)
  const ARROW = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
  const card = ({ flag, name, chip, pre, value, unit, delta, foot, action }) => `
    <div class="tip__head">${flag}<span class="tip__name">${name}</span>${chip ? `<span class="tip__chip">${chip}</span>` : ''}</div>
    <div class="tip__body">${pre ? `<div class="tip__pre">${pre}</div>` : ''}<div class="tip__rate"><b class="num">${value}</b>${unit ? `<span>${unit}</span>` : ''}${delta ?? ''}</div></div>
    <div class="tip__foot"><span class="tip__meta">${foot}</span><span class="tip__action">${action}${ARROW}</span></div>`
  const speed = s => `<span class="speed${s === 'Instant' ? '' : ' slow'}"><i></i>${s}</span>`
  const tipHtml = m => {
    if ((Z.state.filter === 'payin' || Z.state.filter === 'both') && m.payin) return card({ flag: Z.flag(m), name: m.name, chip: Z.state.asset,
      pre: '1 USD =', value: Z.fmt(Z.payinRate(), 4), unit: Z.state.asset, foot: `Payin · 1:1 less ${Z.state.tier} bps`, action: 'History' })
    const meth = m.methods[0]
    return card({ flag: Z.flag(m), name: m.name + (m.note ? ` <span class="tip__note">${m.note}</span>` : ''), chip: m.cur, pre: '1 USDC =',
      value: Z.fmt(m.mid, m.dp), unit: m.cur, delta: `<span class="tip__delta">${Z.delta(Z.change(meth))}<span>24h</span></span>`,
      foot: `${speed(meth.speed)}<span>${m.payin ? 'Payin and payout' : 'Payout'}</span>`, action: 'History' })
  }
  const otherHtml = c => card({ flag: c.iso ? `<img class="flag" src="${Z.flagUrl({ flag: c.iso })}" alt="">` : '', name: c.name,
    value: 'Not live yet', foot: '<span>Want payin or payout here?</span>', action: 'Request it' })
  // Hover card: while a market or an unsupported country is hovered. It sits beside the country's shape, joined
  // to a marker by an L-shaped link, and fades in over 150 ms.
  function placeTip() {
    const k = focusOf(Z.state.filter)
    hov.classList.toggle('is-on', !!(k || other))
    if (!k && !other) return
    const m = k && Z.BY[k], b = k ? BOUNDS[k] : other.main
    const { x, y } = k ? Z.toXY(m) : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
    const ww = el.clientWidth, wh = el.clientHeight, sx = ww / DOTS.w, sy = wh / DOTS.h, mx = x * sx, my = y * sy, drop = 16, gap = 14
    tip.innerHTML = k ? tipHtml(m) : otherHtml(other)
    tip.classList.toggle('is-other', !k); marker.classList.toggle('is-other', !k)
    const tw = tip.offsetWidth, th = tip.offsetHeight
    let tx = b.x1 * sx + gap
    if (tx + tw > ww) tx = b.x0 * sx - gap - tw
    if (tx < 0) tx = Math.min(ww - tw, Math.max(0, mx - tw / 2))
    const ly = Math.min(wh - 8, my + drop), ty = Math.min(wh - th - 4, Math.max(4, ly - th / 2)), flip = tx < mx, ex = flip ? tx + tw : tx
    marker.style.left = mx + 'px'; marker.style.top = my + 'px';
    link.classList.toggle('is-flipped', flip)
    link.style.left = Math.min(mx, ex) + 'px'; link.style.top = my + 'px'; link.style.width = Math.abs(ex - mx) + 'px'; link.style.height = ly - my + 'px'
    link.hidden = ly < ty || ly > ty + th
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px'
  }
  function intro() {
    started = true
    t0 = Z.REDUCED || Z.state.status === 'loading' ? null : performance.now()
    raf = 0; kick()
  }
  // Hover follows the exact shape of lit markets; tiny ones (Singapore, Hong Kong, UAE) also answer to their nearest dot
  const grid = e => { const r = canvas.getBoundingClientRect(), cell = r.width / DOTS.w; return [(e.clientX - r.left) / cell, (e.clientY - r.top) / cell] }
  // Unsupported countries answer to their exact shape (bounds checked first, so a move costs a few path tests)
  const hitOther = e => {
    const [gx, gy] = grid(e)
    return OTHERS.find(c => gx >= c.box.x0 && gx <= c.box.x1 && gy >= c.box.y0 && gy <= c.box.y1 && hitCtx.isPointInPath(c.path, gx, gy, 'evenodd')) ?? null
  }
  const setOther = c => { if (c === other) return; other = c; otherAt = performance.now(); placeTip(); kick() }
  const hit = e => {
    const [gx, gy] = grid(e)
    for (const k in OUTLINE) if (lit(k, Z.state.filter) && hitCtx.isPointInPath(OUTLINE[k], gx, gy, 'evenodd')) return k
    let best = null, bd = 1.2
    for (const d of DOT_LIST) if (d.k && DOT_COUNT[d.k] <= 3 && lit(d.k, Z.state.filter)) { const dd = Math.hypot(d.x + .5 - gx, d.y + .5 - gy); if (dd < bd) { bd = dd; best = d.k } }
    return best
  }
  canvas.addEventListener('pointermove', e => {
    const k = hit(e), c = k ? null : hitOther(e)
    canvas.classList.toggle('is-over', !!(k || c)); Z.setHover(k); setOther(c)
  })
  canvas.addEventListener('pointerleave', () => { Z.setHover(null); setOther(null) })
  canvas.addEventListener('click', e => {
    const k = hit(e)
    if (k) { Z.select(k); Z.setFlow(Z.state.filter === 'payin' || Z.state.filter === 'both' ? 'payin' : 'payout'); o.onPick?.(k); return }
    const c = hitOther(e)
    if (c) o.onRequest?.({ name: c.name, iso: c.iso })
  })
  new ResizeObserver(() => { placeTip(); kick() }).observe(el)
  Z.sub((t, d) => {
    if (t === 'theme') readColors()
    if (t === 'filter') placeTip()
    if (['hover', 'asset', 'tier'].includes(t) || (t === 'tick' && d.key === Z.state.hover)) placeTip()
    if (t === 'replay' || (t === 'status' && d.from === 'loading')) return intro()
    kick()
  })
  whenVisible(el, intro)
  return { intro, kick }
}

// ── Component: filter controls (flow, method, range) ──
// Every instance is bound to the same state, so a filter bar and a rate checker stay in step.
Z.filters = (el, { flow = true, method = true, range = false } = {}) => {
  el.classList.add('filters')
  el.innerHTML = (flow ? '<div class="seg" data-f="flow" role="group" aria-label="Flow"><button data-v="payin">Payin</button><button data-v="payout">Payout</button></div>' : '') +
    (method ? '<div class="filters__method" data-f="method"></div>' : '') +
    (range ? '<div class="seg" data-f="range" role="group" aria-label="Range">' + Object.keys(Z.RANGES).map(r => `<button data-v="${r}">${r}</button>`).join('') + '</div>' : '')
  const q = s => el.querySelector(`[data-f="${s}"]`)
  const draw = () => {
    if (flow) q('flow').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === Z.state.flow))
    if (range) q('range').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === Z.state.range))
    if (method) {
      const v = Z.view()
      q('method').innerHTML = v.flow === 'payin'
        ? `<div class="seg" data-g="asset" role="group" aria-label="Stablecoin">${Object.keys(Z.ASSETS).map(a => `<button data-v="${a}" aria-pressed="${a === Z.state.asset}">${a}</button>`).join('')}</div>
           <select class="select" data-g="tier" aria-label="Monthly volume">${Z.TIERS.map(([b, n]) => `<option value="${b}" ${b === Z.state.tier ? 'selected' : ''}>${n} · ${b} bps</option>`).join('')}</select>`
        : v.m.methods.length > 1
          ? `<div class="seg" data-g="meth" role="group" aria-label="Payout method">${v.m.methods.map((x, i) => `<button data-v="${i}" aria-pressed="${i === Z.state.meth}">${x.name}</button>`).join('')}</div>`
          : `<span class="filters__static">${v.meth.name}</span>`
    }
  }
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return
    const f = b.closest('[data-f]')?.dataset.f, g = b.closest('[data-g]')?.dataset.g
    if (g === 'asset') return Z.setAsset(b.dataset.v)
    if (g === 'meth') return Z.setMeth(+b.dataset.v)
    if (f === 'flow') Z.setFlow(b.dataset.v)
    if (f === 'range') Z.setRange(b.dataset.v)
  })
  el.addEventListener('change', e => { if (e.target.dataset.g === 'tier') Z.setTier(+e.target.value) })
  Z.sub(t => { if (['flow', 'select', 'meth', 'asset', 'tier', 'range', 'status'].includes(t)) draw() })   // status: methods arrive with the first rates
  draw()
}

// ── Component: dithered price chart (Zapyd price only), built like the reference "Inference Calls" plot ──
// Under the line, a 4x4 Bayer threshold keeps a cell when BAYER < 16 * (1 - 0.97 * depth^0.7), so dots are dense at
// the line and thin toward the base. On first load the dots run the shared sweep and the SVG line draws in over
// 770 ms. Later changes redraw in place and fade the numbers.
Z.chart = (el, { height = 215, stats = null, label = true } = {}) => {
  el.classList.add('chart')
  el.innerHTML = `${label ? '<div class="chart__label"></div>' : ''}<div class="chart__box" style="height: ${height}px"><canvas aria-hidden="true"></canvas><svg role="img" aria-label="Zapyd price history"></svg><div class="ctip"></div></div>`
  const box = el.querySelector('.chart__box'), canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d'), svg = el.querySelector('svg'), tip = el.querySelector('.ctip'), lab = el.querySelector('.chart__label')
  const k = height / 215, L = 52, TOP = 14.7 * k, BOT = 192 * k, Y0 = 11 * k, Y1 = 195 * k, XLAB = 209.2 * k, PX = 3.99, PY = 3.97, SZ = 2.59
  let t0 = -Infinity, raf = 0, started = false, cells = [], geo = null, colors = {}
  const readColors = () => { const cs = getComputedStyle(document.documentElement); for (const c of ['dot', 'flash']) colors[c] = cs.getPropertyValue('--chart-' + c).trim() }
  readColors()

  function build(animate) {
    const v = Z.view(), s = v.series(Z.state.range), y = s.v, t = s.t, n = y.length, w = box.clientWidth, r = Math.max(0, w - L)
    if (!r) return
    if (!y[n - 1]) { svg.innerHTML = ''; cells = []; geo = null; if (stats) stats.innerHTML = ''; return kick() }   // no rate yet
    const lo0 = Math.min(...y), hi0 = Math.max(...y), mid = (lo0 + hi0) / 2, span = Math.max(hi0 - lo0, mid * .002)   // flat prices stay flat
    const lo = mid - span * .62, hi = mid + span * .62
    const yOf = val => Y0 + (hi - val) / (hi - lo) * (Y1 - Y0), xOf = i => L + i / (n - 1) * r
    const lineYAt = f => { const p = Math.max(0, Math.min(1, f)) * (n - 1), i = Math.min(n - 2, Math.floor(p)); return yOf(y[i] + (y[i + 1] - y[i]) * (p - i)) }
    cells = []
    const cols = Math.floor((r - SZ) / PX) + 1, rows = Math.floor((BOT - TOP - SZ) / PY) + 1
    for (let m = 0; m < cols; m++) {
      const cx = L + .7 + m * PX, ly = lineYAt((cx + SZ / 2 - L) / r)
      for (let row = 0; row < rows; row++) {
        const cy = TOP + row * PY
        if (cy + SZ / 2 < ly) continue
        const depth = (cy - ly) / (BOT - ly), p = 1 - .97 * Math.pow(depth, .7)
        if (BAYER[row % 4][m % 4] < p * 16) cells.push({ x: cx, y: cy, delay: delayOf(m / cols, m, row) })
      }
    }
    const dp = span < .01 ? Math.max(v.dp, 4) : v.dp, ticks = [0, 1, 2, 3, 4].map(i => hi - (hi - lo) * (i + .5) / 5)
    const rg = Z.state.range, fx = tt => { const d = new Date(tt); return rg === '24H' ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
    const xt = [.1, .3, .5, .7, .9].map(f => Math.round(f * (n - 1)))
    const path = y.map((val, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(2)} ${yOf(val).toFixed(2)}`).join('')
    svg.setAttribute('viewBox', `0 0 ${w} ${height}`)
    svg.innerHTML = ticks.map(tv => `<line class="chart__grid" stroke-dasharray="4 4" x1="${L}" x2="${w}" y1="${yOf(tv)}" y2="${yOf(tv)}"/><text class="chart__axis" x="${L - 7}" y="${yOf(tv) + 3.5}" text-anchor="end">${Z.fmt(tv, dp)}</text>`).join('') +
      `<path class="chart__line${animate ? ' draw-in' : ''}" d="${path}" pathLength="1" ${animate ? `style="animation-duration: ${LINE}ms"` : ''}/>` +
      xt.map(i => `<text class="chart__axis" x="${xOf(i)}" y="${XLAB}" text-anchor="middle">${fx(t[i])}</text>`).join('') +
      `<g class="chart__cross" style="display: none"><line y1="${TOP}" y2="${BOT}"/><circle r="4"/></g>`
    geo = { v, y, t, n, xOf, yOf, dp, short: rg === '24H' || rg === '7D', w }
    if (lab) { lab.innerHTML = `<span class="chart__pair">${Z.flag(v.m)}1 ${v.base} to ${v.quote}</span><span class="muted">${v.flow === 'payin' ? 'Payin' : 'Payout'} · ${v.name}</span>`; swap(lab, animate) }
    if (stats) {
      const last = y[n - 1]
      stats.className = 'stats'
      stats.innerHTML = [['Now', Z.fmt(last, v.dp)], ['High', Z.fmt(hi0, v.dp)], ['Low', Z.fmt(lo0, v.dp)], [`Change · ${rg}`, Z.delta(last / y[0] - 1)]].map(([a, b]) => `<div><span class="label">${a}</span><b class="num sk">${b}</b></div>`).join('')
      swap(stats, animate)
    }
    t0 = animate && !Z.REDUCED ? performance.now() : -Infinity
    raf = 0; kick()
  }
  // Values fade in on change, as the reference's value-swap does
  const swap = (node, animate) => { if (!animate) return; node.classList.remove('value-swap'); void node.offsetWidth; node.classList.add('value-swap') }

  function draw() {
    const dpr = devicePixelRatio || 1, w = box.clientWidth, W = Math.round(w * dpr), H = Math.round(height * dpr)
    if (!W) { raf = 0; return }
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H)
    const since = performance.now() - t0, base = new Path2D(), fl = new Path2D(), loading = Z.state.status === 'loading'
    let busy = loading
    for (const c of cells) {
      if (since < c.delay) { busy = true; continue }
      if (since < c.delay + SETTLE) busy = true
      square(since < c.delay + FLASH ? fl : base, c.x * dpr, c.y * dpr, SZ * dpr)
    }
    ctx.globalAlpha = loading ? .4 + .2 * Math.sin(performance.now() / 300) : 1
    ctx.fillStyle = colors.dot; ctx.fill(base); ctx.fillStyle = colors.flash; ctx.fill(fl)
    raf = busy ? requestAnimationFrame(draw) : 0
  }
  const kick = () => { if (!raf && started) raf = requestAnimationFrame(draw) }

  box.addEventListener('pointermove', e => {
    if (!geo || Z.state.status === 'loading') return
    const rect = box.getBoundingClientRect(), x = e.clientX - rect.left, { v, y, t, n, xOf, yOf, dp, short } = geo
    const i = Math.max(0, Math.min(n - 1, Math.round((x - L) / (rect.width - L) * (n - 1)))), px = xOf(i), py = yOf(y[i]), g = svg.querySelector('.chart__cross')
    if (x < L) { g.style.display = 'none'; tip.classList.remove('is-on'); return }
    g.style.display = ''; g.querySelector('line').setAttribute('x1', px); g.querySelector('line').setAttribute('x2', px)
    g.querySelector('circle').setAttribute('cx', px); g.querySelector('circle').setAttribute('cy', py)
    const d = new Date(t[i])
    tip.innerHTML = `<div class="t">${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${short ? ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</div>
      <div><span>1 ${v.base}</span><b class="num">${Z.fmt(y[i], dp)} ${v.quote}</b></div><div class="muted"><span>Today vs then</span><span class="num">${((y[n - 1] / y[i] - 1) * 100).toFixed(2)}%</span></div>`
    tip.style.left = (px > rect.width / 2 ? px - tip.offsetWidth - 14 : px + 14) + 'px'; tip.classList.add('is-on')
  })
  box.addEventListener('pointerleave', () => { const g = svg.querySelector('.chart__cross'); if (g) g.style.display = 'none'; tip.classList.remove('is-on') })
  let w0 = 0
  new ResizeObserver(() => { if (started && box.clientWidth !== w0) { w0 = box.clientWidth; const keep = t0; build(false); t0 = keep } }).observe(box)
  Z.sub((t, d) => {
    if (!started) return
    if (['flow', 'select', 'meth', 'asset', 'tier', 'range'].includes(t)) { build(false); swap(box, true) }
    if (t === 'tick' && d.key === Z.view().key && performance.now() - t0 > INTRO) build(false)   // never cut an intro short
    if (t === 'theme') { readColors(); raf = 0; kick() }
    if (t === 'replay' || (t === 'status' && d.from === 'loading')) build(true)
    if (t === 'status') kick()
  })
  whenVisible(el, () => { started = true; w0 = box.clientWidth; build(Z.state.status !== 'loading') })
  return { kick }
}

// ── Component: rate checker (today's rate, no amount) ──
Z.rateCheck = (el, { controls = true, list = true } = {}) => {
  el.classList.add('rc')
  el.innerHTML = (controls ? '<div class="rc__controls"></div>' : '') +
    `<div class="rc__rate"><span class="rc__pre"></span><div class="rc__row"><b class="rc__big num sk"></b><span class="rc__cur"></span>
      <button class="rc__swap" type="button" aria-pressed="false" aria-label="Show the inverse rate">${Z.icon.swap}</button></div>
      <div class="rc__meta"></div></div><dl class="rc__facts"></dl><p class="rc__note">Indicative rate, refreshed every minute. Your rate is fixed when you create a quotation.</p>${list ? '<div class="rc__list"></div>' : ''}`
  if (controls) Z.filters(el.querySelector('.rc__controls'))
  const $ = s => el.querySelector(s)
  let invert = false
  const draw = () => {
    const v = Z.view(), r = invert ? 1 / v.rate : v.rate, from = invert ? v.quote : v.base, to = invert ? v.base : v.quote
    $('.rc__pre').textContent = `1 ${from} =`
    const big = $('.rc__big'); big.textContent = invert ? Z.sig(r) : Z.fmt(r, v.dp); $('.rc__cur').textContent = to
    $('.rc__meta').innerHTML = `<span class="sk">${Z.delta(v.change)} <span class="muted">24h</span></span><span class="${v.modelClass}">${v.model}</span>`
    const facts = v.flow === 'payin'
      ? [['Monthly volume', v.name.replace(' a month', '')], ['Credited', 'Instant'], ['Asset', v.quote]]
      : [['Speed', `<span class="speed${v.speed === 'Instant' ? '' : ' slow'}"><i></i>${v.speed}</span>`], ['Fixed fee', v.fee], ['Per transfer', v.meth.limit ?? 'No limit']]
    $('.rc__facts').innerHTML = facts.map(([k, x]) => `<div><dt>${k}</dt><dd>${x}</dd></div>`).join('')
    if (list) $('.rc__list').innerHTML = v.flow === 'payin'
      ? `<div class="label">Deposit fee per transaction</div>${Z.DEPOSITS.map(([n, f]) => `<div class="rc__item"><span>${n}</span><b class="num">${f}</b></div>`).join('')}`
      : `<div class="label">Every method in ${v.m.name}</div>${v.m.methods.map((x, i) => `<button class="rc__item" data-i="${i}" aria-current="${i === Z.state.meth}"><span>${x.name}</span><span class="muted">${x.speed}</span><b class="num sk">${Z.fmt(x.mid, x.dp)}</b></button>`).join('')}`
  }
  $('.rc__swap').addEventListener('click', e => { invert = !invert; e.currentTarget.setAttribute('aria-pressed', invert); draw() })
  el.addEventListener('click', e => { const b = e.target.closest('.rc__item[data-i]'); if (b) Z.setMeth(+b.dataset.i) })
  const rate = $('.rc__rate')
  Z.sub((t, d) => {
    if (['flow', 'select', 'meth', 'asset', 'tier'].includes(t)) { draw(); rate.classList.remove('value-swap'); void rate.offsetWidth; rate.classList.add('value-swap') }
    if (t === 'tick' && d.key === Z.view().key) draw()
  })
  draw()
}
})()
