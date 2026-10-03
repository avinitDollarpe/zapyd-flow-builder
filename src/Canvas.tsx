import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Flow, Tone } from './flow'
import { Icon } from './icons'

interface Wire {
  d: string
  x1: number
  y1: number
  x2: number
  y2: number
  tone: Tone
  hot: boolean
}

const PAD = 24
const MIN_FIT = 0.6
const DEFAULT_ZOOM = 0.81

export interface Insets {
  l: number
  r: number
  t: number
  b: number
}

export function Canvas({
  flow,
  active,
  onPick,
  insets,
}: {
  flow: Flow
  active: string | null
  onPick: (id: string) => void
  // Space covered by floating panels. Cards fit and center in what is left.
  insets: Insets
}) {
  const view = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [wires, setWires] = useState<Wire[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [cam, setCam] = useState({ x: 0, y: 0, z: 1 })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Camera moves glide after a button press or a panel toggle; never while dragging or wheeling.
  const [smooth, setSmooth] = useState(false)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)

  // Wires are measured from the rendered cards, in unscaled stage coordinates.
  const measure = useCallback(() => {
    const st = stage.current
    if (!st) return
    const box = st.getBoundingClientRect()
    const z = box.width / st.offsetWidth || 1
    const at = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { l: (r.left - box.left) / z, r: (r.right - box.left) / z, t: (r.top - box.top) / z, b: (r.bottom - box.top) / z }
    }
    const hotGroups = new Set(flow.groups.filter((g) => g.rows.some((r) => r.id === active)).map((g) => g.id))
    const owner = (rowId: string) => flow.groups.find((g) => g.rows.some((r) => r.id === rowId))!
    // Top to bottom: each wire leaves the bottom of its group and lands on the
    // top of the next one. Several wires into one group spread along its top edge.
    const centerX = (rowId: string) => {
      const el = st.querySelector(`[data-group="${owner(rowId).id}"]`)
      return el ? (at(el).l + at(el).r) / 2 : 0
    }
    const incoming = new Map<string, string[]>()
    for (const e of flow.edges) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from])
    // Order landing points by where each wire starts, so wires never cross.
    for (const list of incoming.values()) list.sort((p, q) => centerX(p) - centerX(q))
    const out: Wire[] = []
    for (const e of flow.edges) {
      const group = owner(e.from)
      const fromEl = st.querySelector(`[data-group="${group.id}"]`)
      const toEl = st.querySelector(`[data-group="${e.to}"]`)
      if (!fromEl || !toEl) continue
      const a = at(fromEl)
      const b = at(toEl)
      const ins = incoming.get(e.to)!
      const k = ins.indexOf(e.from)
      const x1 = (a.l + a.r) / 2
      const x2 = b.l + ((b.r - b.l) * (k + 1)) / (ins.length + 1)
      const y1 = a.b + 6
      const y2 = b.t - 6
      const mid = Math.max(18, (y2 - y1) / 2)
      out.push({
        d: `M${x1},${y1} C${x1},${y1 + mid} ${x2},${y2 - mid} ${x2},${y2}`,
        x1,
        y1,
        x2,
        y2,
        tone: e.tone,
        hot: hotGroups.has(group.id) || hotGroups.has(e.to),
      })
    }
    setWires(out)
    setSize({ w: st.offsetWidth, h: st.offsetHeight })
  }, [flow, active])

  useLayoutEffect(measure, [measure])
  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (stage.current) ro.observe(stage.current)
    return () => ro.disconnect()
  }, [measure])

  const fit = useCallback(() => {
    const v = view.current
    const st = stage.current
    if (!v || !st) return
    setSmooth(true)
    const w = v.clientWidth - insets.l - insets.r - PAD * 2
    const h = v.clientHeight - insets.t - insets.b - PAD * 2
    // Below MIN_FIT the cards are unreadable: start at the left of the free area and let the user pan.
    const z = Math.max(MIN_FIT, Math.min(1, w / st.offsetWidth, h / st.offsetHeight))
    setCam({
      z,
      x: insets.l + PAD + Math.max(0, (w - st.offsetWidth * z) / 2),
      y: insets.t + PAD + Math.max(0, (h - st.offsetHeight * z) / 2),
    })
  }, [insets])

  // Every flow opens at the same zoom, centred in the free area. A flow taller
  // than the space starts at its top so the source is always in view.
  const home = useCallback(() => {
    const v = view.current
    const st = stage.current
    if (!v || !st) return
    const w = v.clientWidth - insets.l - insets.r
    const h = v.clientHeight - insets.t - insets.b - PAD * 2
    const z = DEFAULT_ZOOM
    setCam({
      z,
      // A flow wider than the free area starts at its left edge instead of sliding under the panel.
      x: insets.l + Math.max(PAD, (w - st.offsetWidth * z) / 2),
      y: insets.t + PAD + Math.max(0, (h - st.offsetHeight * z) / 2),
    })
  }, [insets])

  // Reset on mount (the app remounts the canvas for each flow) and on resize.
  // After mount, a panel opening or closing changes the insets: glide to the new centre.
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (mounted.current) setSmooth(true)
    mounted.current = true
    home()
  }, [home])
  useEffect(() => {
    const ro = new ResizeObserver(home)
    if (view.current) ro.observe(view.current)
    return () => ro.disconnect()
  }, [home])

  const zoom = (k: number) => {
    setSmooth(true)
    setCam((c) => {
      const v = view.current!
      const z = Math.min(1.6, Math.max(0.4, c.z * k))
      const cx = v.clientWidth / 2
      const cy = v.clientHeight / 2
      return { z, x: cx - ((cx - c.x) * z) / c.z, y: cy - ((cy - c.y) * z) / c.z }
    })
  }

  useEffect(() => {
    const v = view.current
    if (!v) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setSmooth(false)
      if (e.ctrlKey || e.metaKey) {
        const k = Math.exp(-e.deltaY * 0.01)
        const r = v.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        setCam((c) => {
          const z = Math.min(1.6, Math.max(0.4, c.z * k))
          return { z, x: px - ((px - c.x) * z) / c.z, y: py - ((py - c.y) * z) / c.z }
        })
      } else setCam((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
    }
    v.addEventListener('wheel', onWheel, { passive: false })
    return () => v.removeEventListener('wheel', onWheel)
  }, [])

  const cols = [...new Set(flow.groups.map((g) => g.col))].sort((a, b) => a - b)

  return (
    <div
      ref={view}
      className="canvas"
      onPointerDown={(e) => {
        if ((e.target as Element).closest('button, a, .dock')) return
        setSmooth(false)
        drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) setCam((c) => ({ ...c, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y }))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div ref={stage} className={`stage${smooth ? ' smooth' : ''}`} style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})` }}>
        <svg className="wires" width={size.w} height={size.h} aria-hidden="true">
          {wires.map((w, i) => (
            <g key={i} className={`wire tone-${w.tone}${w.hot ? ' hot' : ''}`}>
              <path d={w.d} />
              <circle cx={w.x1} cy={w.y1} r={3} />
              <circle cx={w.x2} cy={w.y2} r={3} />
            </g>
          ))}
        </svg>
        {cols.map((c) => (
          <div className="col" key={c}>
            {flow.groups
              .filter((g) => g.col === c)
              .map((g) => {
                const shut = collapsed.has(g.id)
                return (
                  <section key={g.id} data-group={g.id} className={`group${g.dashed ? ' dashed' : ''}`} aria-label={g.title}>
                    <button
                      className="group-head"
                      data-head={g.id}
                      aria-expanded={!shut}
                      onClick={() =>
                        setCollapsed((s) => {
                          const n = new Set(s)
                          if (n.has(g.id)) n.delete(g.id)
                          else n.add(g.id)
                          return n
                        })
                      }
                    >
                      <span className={`chev${shut ? ' shut' : ''}`}>
                        <Icon name="chevron-down" size={14} />
                      </span>
                      <span className="group-title">{g.title}</span>
                      {g.tag && (
                        <span className={`tag tone-${g.tag.tone}`}>
                          {g.tag.warn && <Icon name="warn" size={12} />}
                          {g.tag.label}
                        </span>
                      )}
                    </button>
                    <div className={`rows-wrap${shut ? ' shut' : ''}`} inert={shut || undefined}>
                      <div className="rows">
                        {g.rows.map((r) => {
                          const Tag = r.step ? 'button' : 'div'
                          return (
                            <Tag
                              key={r.id}
                              data-row={r.id}
                              className={`row kind-${r.kind}${active === r.id ? ' active' : ''}`}
                              {...(r.step ? { onClick: () => onPick(r.id), title: `Step ${r.step}: show the code` } : {})}
                            >
                              <span className="row-icon">
                                <Icon name={r.icon} size={r.icon.includes(':') ? 18 : 14} />
                              </span>
                              <span className="row-text">
                                <span className="row-label">{r.label}</span>
                                {r.sub && <span className="row-sub">{r.sub}</span>}
                              </span>
                              {r.step && <span className="row-step">{r.step}</span>}
                            </Tag>
                          )
                        })}
                      </div>
                    </div>
                  </section>
                )
              })}
          </div>
        ))}
      </div>
      <div className="dock" style={{ left: insets.l, right: insets.r }}>
        <div className="float dock-bar">
          <div className="legend" aria-hidden="true">
            <span className="kind-api">API call</span>
            <span className="kind-action">You or the user</span>
            <span className="kind-event">Webhook</span>
          </div>
          <span className="dock-sep" />
          <div className="zoom" role="toolbar" aria-label="Zoom">
            <button onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">
              <Icon name="minus" size={14} />
            </button>
            <span className="zoom-val">{Math.round(cam.z * 100)}%</span>
            <button onClick={() => zoom(1.2)} aria-label="Zoom in">
              <Icon name="plus" size={14} />
            </button>
            <button onClick={fit} aria-label="Fit to view">
              <Icon name="fit" size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
