import { useState, type ReactNode } from 'react'
import { HOST, docsUrl, type Flow, type Step } from './flow'
import { Icon, Swap } from './icons'
import { prompt } from './prompt'

function curl(st: Step) {
  const lines = [`curl -X ${st.method} '${HOST}${st.path}' \\`]
  if (st.body) lines.push(`  -H 'Content-Type: application/json' \\`)
  lines.push(`  -H "X-API-KEY: $ZAPYD_API_KEY" \\`, `  -H "X-TIMESTAMP: $TIMESTAMP" \\`)
  lines.push(`  -H "X-SIGNATURE: $SIGNATURE"${st.body ? ' \\' : ''}`)
  if (st.body) lines.push(`  -d '${JSON.stringify(st.body, null, 2).replace(/\n/g, '\n  ')}'`)
  return lines.join('\n')
}

function useCopy() {
  const [done, setDone] = useState<string | null>(null)
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setDone(key)
      setTimeout(() => setDone((d) => (d === key ? null : d)), 1400)
    })
  }
  return { done, copy }
}

// `code` spans and [links](url) inside step text.
export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = []
  const re = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[3]) parts.push(<code key={m.index}>{m[3]}</code>)
    else
      parts.push(
        <a key={m.index} href={docsUrl(m[2])} target="_blank" rel="noreferrer">
          <Rich text={m[1]} />
        </a>,
      )
    last = re.lastIndex
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

// Light highlighting for cURL with a JSON body.
export function Highlight({ code }: { code: string }) {
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|('https?:[^']*')|(\s-[A-Za-z]\b)|(\$[A-Z_]+)|\b(true|false|null)\b|(\b\d+(?:\.\d+)?\b)|(^curl\b)/gm
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const cls = m[1] ? (m[2] ? 'tk-key' : 'tk-str') : m[3] ? 'tk-url' : m[4] ? 'tk-flag' : m[5] ? 'tk-var' : m[6] ? 'tk-bool' : m[7] ? 'tk-num' : 'tk-cmd'
    out.push(
      <span key={m.index} className={cls}>
        {m[1] ?? m[0]}
      </span>,
    )
    if (m[2]) out.push(m[2])
    last = re.lastIndex
  }
  out.push(code.slice(last))
  return <>{out}</>
}

export function Code({
  flow,
  active,
  onHover,
  onClose,
}: {
  flow: Flow
  active: string | null
  onHover: (id: string | null) => void
  onClose?: () => void
}) {
  const [tab, setTab] = useState<'curl' | 'ai'>('curl')
  const { done, copy } = useCopy()
  const all = () =>
    tab === 'ai'
      ? prompt(flow)
      : flow.steps
          .filter((s) => s.method)
          .map((s) => `# ${s.n}. ${s.title}\n${curl(s)}`)
          .join('\n\n')

  return (
    <section className="code-panel" aria-label="Code">
      <header className="panel-head">
        <span className="panel-title">
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Hide API calls" title="Hide API calls">
              <Icon name="chevron-right" size={16} />
            </button>
          )}
          API calls
          <span className="flow-name">{flow.steps.length} steps</span>
        </span>
        <div className="panel-tools">
          <button className="icon-btn" onClick={() => copy('all', all())} aria-label={tab === 'ai' ? 'Copy prompt' : 'Copy every cURL'} title={tab === 'ai' ? 'Copy prompt' : 'Copy every cURL'}>
            <Swap on={done === 'all'} a="copy" b="check" size={14} />
          </button>
          <div className="seg" role="tablist" aria-label="Format">
            <button role="tab" aria-selected={tab === 'curl'} onClick={() => setTab('curl')}>
              cURL
            </button>
            <button role="tab" aria-selected={tab === 'ai'} onClick={() => setTab('ai')}>
              AI agent
            </button>
          </div>
        </div>
      </header>

      {tab === 'ai' ? (
        <div className="steps">
          <p className="auth-note">Paste this prompt into your coding agent. It describes every call in this flow, in order.</p>
          <div className="block">
            <div className="block-head">
              <span>Prompt</span>
              <button className="icon-btn" onClick={() => copy('ai', prompt(flow))} aria-label="Copy prompt">
                <Swap on={done === 'ai'} a="copy" b="check" size={14} />
              </button>
            </div>
            <pre className="prose-pre">{prompt(flow)}</pre>
          </div>
        </div>
      ) : (
        <ol className="steps">
          <li className="auth-note">
            Every request is signed. <code>X-SIGNATURE</code> is Base64(HMAC-SHA256(secret, <code>apiKey|timestamp|canonicalJson</code>)).{' '}
            <a href={docsUrl('/api-reference-exchange/overview/authentication')} target="_blank" rel="noreferrer">
              Authentication
            </a>
          </li>
          {flow.steps.map((st) => (
            <li
              key={st.id}
              id={`step-${st.id}`}
              className={`step kind-${st.kind}${active === st.id ? ' active' : ''}`}
              onMouseEnter={() => onHover(st.id)}
              onMouseLeave={() => onHover(null)}
            >
              <span className="step-num">{st.n}</span>
              <div className="step-body">
                <div className="step-head">
                  <h3>{st.title}</h3>
                  {st.kind !== 'api' && <span className={`kind-chip kind-${st.kind}`}>{st.kind === 'event' ? 'Webhook' : 'Action'}</span>}
                </div>
                <p>
                  <Rich text={st.text} />
                </p>
                {st.method && (
                  <div className="block">
                    <div className="block-head">
                      <span>
                        <b className={`verb verb-${st.method}`}>{st.method}</b> {st.path}
                      </span>
                      <span className="block-tools">
                        {st.docs && (
                          <a className="icon-btn" href={docsUrl(st.docs)} target="_blank" rel="noreferrer" aria-label="Open in the API reference">
                            <Icon name="book" size={14} />
                          </a>
                        )}
                        <button className="icon-btn" onClick={() => copy(st.id, curl(st))} aria-label="Copy cURL">
                          <Swap on={done === st.id} a="copy" b="check" size={14} />
                        </button>
                      </span>
                    </div>
                    <pre>
                      <code>
                        <Highlight code={curl(st)} />
                      </code>
                    </pre>
                  </div>
                )}
                {!st.method && st.docs && (
                  <a className="step-link" href={docsUrl(st.docs)} target="_blank" rel="noreferrer">
                    Read the guide <Icon name="arrow-right" size={12} />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
