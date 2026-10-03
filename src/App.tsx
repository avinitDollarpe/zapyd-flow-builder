import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from './Canvas'
import { Code } from './Code'
import { DEFAULTS, DESTINATIONS, NETWORKS, SOURCES, build, choices, coin, kindOf, market, normalize, pairFor, railName, stepFor, subtitle, type Opts, type Side } from './flow'
import { Icon, Swap } from './icons'
import { useTheme } from './theme'

const params = new URLSearchParams(location.search)
const EMBED = params.has('embed')

// Popular flows, ordered onramp, offramp, cross-border. `note` is the detail
// that makes each one worth a shortcut.
const POPULAR: { o: Partial<Opts> & { src: string; dst: string }; note: string }[] = [
  { o: { src: 'INR', dst: 'USDC', network: 'polygon', payinMethod: 'UPI' }, note: 'UPI' },
  { o: { src: 'USD', dst: 'USDC', network: 'polygon', payinMethod: 'WIRE' }, note: 'Wire' },
  { o: { src: 'USDC', dst: 'INR', network: 'polygon', rail: 'ACCOUNT_DETAILS' }, note: 'IMPS' },
  { o: { src: 'USDC', dst: 'MXN', network: 'solana' }, note: 'SPEI' },
  { o: { src: 'USDC', dst: 'EUR', network: 'ethereum' }, note: 'SEPA' },
  { o: { src: 'USDC', dst: 'BRL', funding: 'prefunded' }, note: 'Prefunded' },
  { o: { src: 'USD', dst: 'INR', payinMethod: 'WIRE' }, note: 'RDA' },
  { o: { src: 'USD', dst: 'MXN', payinMethod: 'WIRE' }, note: 'Wire' },
]

function readHash(): Opts {
  const h = new URLSearchParams(location.hash.slice(1))
  const o = { ...DEFAULTS } as Record<string, string>
  for (const k of Object.keys(DEFAULTS)) {
    const v = h.get(k)
    if (v) o[k] = v
  }
  const opts = o as unknown as Opts
  // Only codes the pickers can offer: payin fiats and stablecoins as a source,
  // payout fiats and stablecoins as a destination.
  if (!SOURCES.includes(opts.src)) opts.src = DEFAULTS.src
  if (!DESTINATIONS.includes(opts.dst)) opts.dst = DEFAULTS.dst
  if (kindOf(opts) === 'unsupported') opts.dst = coin(opts.src) ? 'MXN' : 'USDC'
  return normalize(opts)
}

export default function App() {
  const [opts, setOpts] = useState<Opts>(readHash)
  const [theme, setTheme] = useTheme()
  const [active, setActive] = useState<string | null>(null)
  const flow = useMemo(() => build(opts), [opts])
  const c = choices(opts)

  const set = (patch: Partial<Opts>) => setOpts((o) => normalize({ ...o, ...patch }))

  const hash = new URLSearchParams(opts as unknown as Record<string, string>).toString()
  useEffect(() => history.replaceState(null, '', '#' + hash), [hash])

  const pick = (id: string) => {
    setActive(id)
    document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const kind = kindOf(opts)
  // A pick locks the code and its method together.
  const commit = (side: Side, code: string, method: string) => {
    const patch: Partial<Opts> = pairFor(opts, side, code)
    if (coin(code)) patch.network = method
    else if (side === 'src') patch.payinMethod = method
    else patch.rail = method
    set(patch)
  }
  const [codeOpen, setCodeOpen] = useState(true)
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 900px)').matches)
  useEffect(() => {
    const mq = matchMedia('(max-width: 900px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  // Panels float over the canvas; on narrow screens they stack instead.
  const insets = useMemo(
    () => (narrow ? { l: 0, r: 0, t: 0, b: 72 } : { l: PANEL_L, r: codeOpen ? PANEL_R : 0, t: 16, b: 72 }),
    [narrow, codeOpen],
  )

  return (
    <div className={`app${EMBED ? ' embed' : ''}${codeOpen ? '' : ' code-closed'}`}>

      <main className="stage-area" aria-label="Flow">
        {'unsupported' in flow ? (
          <div className="empty" style={{ paddingLeft: insets.l, paddingRight: insets.r }}>
            <Icon name="warn" size={18} />
            <p>{flow.unsupported}</p>
          </div>
        ) : (
          <Canvas key={hash} flow={flow} active={active} onPick={pick} insets={insets} />
        )}
      </main>

      <aside className="float panel panel-config" aria-label="Build your flow">
        <header className="panel-top">
          {EMBED ? (
            <span className="panel-heading">Build your flow</span>
          ) : (
            <span className="brand">
              <img className="logo logo-light" src="/zapyd-light.svg" alt="Zapyd" height={20} />
              <img className="logo logo-dark" src="/zapyd-dark.svg" alt="Zapyd" height={20} />
            </span>
          )}
          {!EMBED && (
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <Swap on={theme === 'dark'} a="moon" b="sun" size={16} />
            </button>
          )}
        </header>

        <section className="cfg route" aria-label="Route">
          <Endpoint label="From" side="src" opts={opts} code={opts.src} method={methodOf(opts, 'src')} onCommit={commit} />
          {(!market(opts.dst) || market(opts.dst)!.payin) && (
            <button className="route-swap" aria-label="Swap source and destination" title="Swap source and destination" onClick={() => set({ src: opts.dst, dst: opts.src })}>
              <Icon name="swap" size={12} />
            </button>
          )}
          <Endpoint label="To" side="dst" opts={opts} code={opts.dst} method={methodOf(opts, 'dst')} onCommit={commit} />
          <p className={`route-kind kind-${kind}`}>
            <span className="route-kind-dot" />
            {KIND_TEXT[kind]}
          </p>
        </section>

        {(c.funding || c.kyc.length > 1) && (
          <section className="cfg" aria-label="Options">
            {c.funding && (
              <Setting
                title="Funding"
                value={opts.funding}
                onChange={(v) => set({ funding: v as Opts['funding'] })}
                items={[
                  { value: 'jit', label: 'Per order', sub: 'Send crypto for each payout' },
                  { value: 'prefunded', label: 'Prefunded', sub: 'Each payout debits a balance you top up' },
                ]}
              />
            )}
            {c.kyc.length > 1 && (
              <Setting
                title="KYC"
                value={opts.kyc}
                onChange={(v) => set({ kyc: v as Opts['kyc'] })}
                items={[
                  { value: 'sdk', label: 'SDK', sub: 'Hosted flow, the user verifies' },
                  { value: 'sharing', label: 'Sharing', sub: 'Send data you already verified' },
                ]}
              />
            )}
          </section>
        )}

        <details className="cfg popular">
          <summary>
            Popular flows
            <Icon name="chevron-down" size={14} />
          </summary>
          <ul className="presets">
            {POPULAR.map((p) => {
              const k = kindOf(p.o)
              const on = p.o.src === opts.src && p.o.dst === opts.dst
              return (
                <li key={p.o.src + p.o.dst + p.note}>
                  <button className="preset" aria-current={on} onClick={() => setOpts(normalize({ ...DEFAULTS, ...p.o }))}>
                    <span className="preset-pair" aria-hidden="true">
                      <Icon name={market(p.o.src) ? `flag:${p.o.src}` : `coin:${p.o.src}`} size={20} />
                      <Icon name={market(p.o.dst) ? `flag:${p.o.dst}` : `coin:${p.o.dst}`} size={20} />
                    </span>
                    <span className="preset-code">{p.o.src}</span>
                    <Icon name="arrow-right" size={12} />
                    <span className="preset-code">{p.o.dst}</span>
                    <span className="preset-meta">
                      <span className="preset-note">{p.note}</span>
                      <span className={`preset-kind kind-${k}`}>{KIND_SHORT[k]}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </details>
      </aside>

      {'steps' in flow &&
        (codeOpen ? (
          <aside className="float panel panel-code" aria-label="API calls">
            <Code flow={flow} active={active} onHover={setActive} onClose={narrow ? undefined : () => setCodeOpen(false)} />
          </aside>
        ) : (
          <button className="float code-open" onClick={() => setCodeOpen(true)}>
            <Icon name="terminal" size={14} />
            API calls
            <span className="flow-name">{flow.steps.length}</span>
          </button>
        ))}
    </div>
  )
}

const KIND_SHORT: Record<ReturnType<typeof kindOf>, string> = {
  onramp: 'Onramp',
  offramp: 'Offramp',
  remittance: 'Cross-border',
  unsupported: '',
}

const KIND_TEXT: Record<ReturnType<typeof kindOf>, string> = {
  offramp: 'Offramp · stablecoins to a bank account',
  onramp: 'Onramp · bank transfer to stablecoins',
  remittance: 'Cross-border · fiat to fiat through stablecoins',
  unsupported: 'Pick a different pair',
}

// Fixed panel footprints, used to keep the cards clear of them.
const PANEL_L = 16 + 312
const PANEL_R = 16 + 400

// ---------------------------------------------------------------- controls

function Endpoint(props: {
  label: string
  side: Side
  opts: Opts
  code: string
  method: string
  onCommit: (side: Side, code: string, method: string) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const m = market(props.code)
  const name = m ? m.currency : coin(props.code)?.name
  const via = methodLabel(props.code, props.method)
  return (
    <div className="endpoint">
      <button
        className="ep"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-label={`${props.label}: ${name}${via ? `, ${via}` : ''}. Change`}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <span className="ep-icon">
          <Icon name={m ? `flag:${props.code}` : `coin:${props.code}`} size={28} />
        </span>
        <span className="ep-text">
          <span className="ep-label">{props.label}</span>
          <span className="ep-name">
            {name}
            <span className="ep-code">{props.code}</span>
          </span>
          {via && <span className="ep-via">{via}</span>}
        </span>
        <Icon name="chevrons-up-down" size={14} />
      </button>
      {anchor && (
        <CurrencyDialog
          side={props.side}
          opts={props.opts}
          code={props.code}
          method={props.method}
          anchor={anchor}
          onCommit={(c, me) => props.onCommit(props.side, c, me)}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  )
}

// The method shown with a code: network for a stablecoin, payin method or rail for a fiat.
const methodOf = (o: Opts, side: 'src' | 'dst') => {
  const code = side === 'src' ? o.src : o.dst
  if (coin(code)) return o.network
  return side === 'src' ? o.payinMethod : o.rail
}
const methodLabel = (code: string, method: string) => {
  if (!method) return ''
  if (coin(code)) return `on ${NETWORKS[method] ?? method}`
  return `via ${railName(method)}`
}

const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

// Transform that maps one box onto another, for the morph.
function onto(el: HTMLElement, target: HTMLElement) {
  const a = target.getBoundingClientRect()
  const d = el.getBoundingClientRect()
  return `translate(${a.left - d.left}px, ${a.top - d.top}px) scale(${a.width / d.width}, ${a.height / d.height})`
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Centered command palette that grows out of the row that opened it. Step one
// picks the currency or asset; step two picks its network, payin method or
// payout rail, and both lock together. A native <dialog> gives focus
// trapping, Escape and the backdrop.
function CurrencyDialog(p: {
  side: Side
  opts: Opts
  code: string
  method: string
  anchor: HTMLElement
  onCommit: (code: string, method: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const closing = useRef(false)
  // Size before a step change; the dialog then morphs to its new size, centred.
  const prevHeight = useRef<number | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [dir, setDir] = useState<'in' | 'back' | null>(null)

  // Step one
  const all = p.side === 'src' ? SOURCES : DESTINATIONS
  const needle = q.trim().toLowerCase()
  const codes = all.filter((code) => {
    const m = market(code)
    return (m ? `${code} ${m.currency} ${m.country}` : `${code} ${coin(code)!.name}`).toLowerCase().includes(needle)
  })
  const groups = [
    { title: 'Stablecoins', codes: codes.filter((c) => !market(c)) },
    { title: p.side === 'src' ? 'Pay in with fiat' : 'Pay out to fiat', codes: codes.filter((c) => market(c)) },
  ].filter((g) => g.codes.length)

  // Step two
  const step = picked ? stepFor(p.opts, p.side, picked) : null
  const options = step ? step.items.filter((it) => !it.disabled).map((it) => it.value) : []
  const flat = step ? options : groups.flatMap((g) => g.codes)

  const [active, setActive] = useState(() => p.code)
  const current = flat.includes(active) ? active : flat[0]

  useLayoutEffect(() => {
    const d = ref.current!
    d.showModal()
    // showModal focuses the first button; start in the search instead.
    searchRef.current?.focus()
    if (reduced()) return
    d.animate([{ transform: onto(d, p.anchor), opacity: 0.6, borderRadius: '12px' }, { transform: 'none', opacity: 1, borderRadius: '20px' }], {
      duration: 320,
      easing: EASE,
    })
    d.querySelector('.cmd')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 100, easing: 'ease-out', fill: 'backwards' })
  }, [p.anchor])

  // Slide the step content in the direction of travel, and morph the
  // dialog's height from the old step to the new one.
  useLayoutEffect(() => {
    if (!dir || reduced()) return
    const d = ref.current
    const from = prevHeight.current
    if (d && from && from !== d.offsetHeight)
      d.animate([{ height: `${from}px` }, { height: `${d.offsetHeight}px` }], { duration: 280, easing: EASE })
    listRef.current?.animate(
      [
        { transform: `translateX(${dir === 'in' ? 16 : -16}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 200, easing: EASE },
    )
  }, [picked, dir])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [current, picked])

  const close = () => {
    const d = ref.current
    if (!d || closing.current) return
    closing.current = true
    const done = () => {
      d.close()
      p.onClose()
      p.anchor.focus()
    }
    if (reduced()) return done()
    d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards', pseudoElement: '::backdrop' })
    d.animate([{ transform: 'none', opacity: 1 }, { transform: onto(d, p.anchor), opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' }).onfinish = done
  }
  const pickCode = (code: string) => {
    prevHeight.current = ref.current?.offsetHeight ?? null
    setPicked(code)
    setDir('in')
    // Keep the current method highlighted when re-picking the same code.
    setActive(code === p.code ? p.method : '')
    ref.current?.focus()
  }
  const back = () => {
    prevHeight.current = ref.current?.offsetHeight ?? null
    setActive(picked ?? '')
    setPicked(null)
    setDir('back')
    requestAnimationFrame(() => searchRef.current?.focus())
  }
  const pickMethod = (method: string) => {
    p.onCommit(picked!, method)
    close()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = flat.indexOf(current)
      setActive(flat[(i + (e.key === 'ArrowDown' ? 1 : flat.length - 1)) % Math.max(flat.length, 1)])
    } else if (e.key === 'Enter' && current) {
      e.preventDefault()
      if (step) pickMethod(current)
      else pickCode(current)
    } else if (step && (e.key === 'ArrowLeft' || e.key === 'Backspace')) {
      e.preventDefault()
      back()
    }
  }

  const pm = picked ? market(picked) : null
  const title = p.side === 'src' ? 'Send from' : 'Send to'

  return (
    <dialog
      ref={ref}
      className="float picker"
      aria-label={title}
      onKeyDown={onKey}
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="cmd">
        {step ? (
          <header className="cmd-step">
            <button className="icon-btn" onClick={back} aria-label="Back to currencies">
              <Icon name="chevron-left" size={16} />
            </button>
            <Icon name={pm ? `flag:${picked}` : `coin:${picked}`} size={24} />
            <span className="cmd-step-text">
              <span className="cmd-step-title">{step.title}</span>
              <span className="cmd-step-sub">
                {pm ? pm.currency : coin(picked!)!.name} · {picked}
              </span>
            </span>
          </header>
        ) : (
          <input
            ref={searchRef}
            className="cmd-search"
            placeholder={`${title}… search currencies or assets`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            aria-activedescendant={current ? `cmd-${current}` : undefined}
          />
        )}
        <div className="cmd-list" id="cmd-list" role="listbox" aria-label={step ? step.title : title} ref={listRef}>
          {step
            ? step.items.map((it) => (
                <div
                  key={it.value}
                  id={`cmd-${it.value}`}
                  role="option"
                  aria-selected={it.value === current}
                  aria-disabled={!!it.disabled}
                  className={`cmd-item${it.disabled ? ' disabled' : ''}`}
                  onMouseMove={() => !it.disabled && setActive(it.value)}
                  onClick={() => !it.disabled && pickMethod(it.value)}
                >
                  {step.key === 'network' ? (
                    <Icon name={`net:${it.value}`} size={32} />
                  ) : (
                    <span className="cmd-glyph">
                      <Icon name={step.key === 'payinMethod' ? 'arrow-down' : 'landmark'} size={16} />
                    </span>
                  )}
                  <span className="cmd-text">
                    <span className="cmd-name">{it.label}</span>
                    <span className="cmd-sub">{it.disabled ?? it.sub}</span>
                  </span>
                  {picked === p.code && it.value === p.method && <Icon name="check" size={14} />}
                  <span className="cmd-code">{it.value}</span>
                </div>
              ))
            : groups.map((g) => (
                <div key={g.title} role="group" aria-label={g.title}>
                  <p className="cmd-group">{g.title}</p>
                  {g.codes.map((code) => {
                    const m = market(code)
                    return (
                      <div
                        key={code}
                        id={`cmd-${code}`}
                        role="option"
                        aria-selected={code === current}
                        className="cmd-item"
                        onMouseMove={() => setActive(code)}
                        onClick={() => pickCode(code)}
                      >
                        <Icon name={m ? `flag:${code}` : `coin:${code}`} size={32} />
                        <span className="cmd-text">
                          <span className="cmd-name">{m ? m.currency : coin(code)!.name}</span>
                          <span className="cmd-sub">{subtitle(code, p.side)}</span>
                        </span>
                        {code === p.code && <Icon name="check" size={14} />}
                        <span className="cmd-code">{code}</span>
                        <Icon name="chevron-right" size={14} />
                      </div>
                    )
                  })}
                </div>
              ))}
          {!step && !flat.length && <p className="cmd-empty">Nothing matches “{q}”.</p>}
        </div>
      </div>
    </dialog>
  )
}

// One option row: label on the left, a small segmented control on the right.
// Each option's explanation is its tooltip, so the panel stays quiet.
function Setting(p: {
  title: string
  value: string
  onChange: (v: string) => void
  items: { value: string; label: string; sub: string; disabled?: string }[]
}) {
  return (
    <div className="setting">
      <span className="setting-title">{p.title}</span>
      <div className="seg" role="radiogroup" aria-label={p.title}>
        {p.items.map((it) => (
          <button
            key={it.value}
            role="radio"
            aria-checked={p.value === it.value}
            disabled={!!it.disabled}
            title={it.disabled ?? it.sub}
            onClick={() => p.onChange(it.value)}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}
