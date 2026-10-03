// Builds every source, destination and option combination and checks the
// flow is well formed. Run with `npm run check`.
import assert from 'node:assert/strict'
import { COINS, DEFAULTS, MARKETS, build, choices, normalize, type Opts } from '../src/flow'
import { prompt } from '../src/prompt'

const codes = [...COINS.map((c) => c.code), ...MARKETS.map((m) => m.fiat)]
let flows = 0

for (const src of codes)
  for (const dst of codes)
    for (const funding of ['jit', 'prefunded'] as const)
      for (const purpose of ['payout', 'remittance'] as const)
        for (const kyc of ['sdk', 'sharing'] as const) {
          const o: Opts = normalize({ ...DEFAULTS, src, dst, funding, purpose, kyc })
          const c = choices(o)
          const rails = c.rails.filter((r) => !r.disabled).map((r) => r.method)
          for (const rail of rails.length ? rails : [''])
            for (const network of c.networks.length ? c.networks : ['']) {
              const f = build(normalize({ ...o, rail, network }))
              if ('unsupported' in f) continue
              flows++
              const at = `${src}->${dst} ${funding} ${purpose} ${kyc} ${rail} ${network}`
              assert.deepEqual(f.steps.map((s) => s.n), f.steps.map((_, i) => i + 1), at)
              const rows = new Set(f.groups.flatMap((g) => g.rows.map((r) => r.id)))
              const groups = new Set(f.groups.map((g) => g.id))
              for (const e of f.edges) {
                assert(rows.has(e.from), `${at}: edge from ${e.from}`)
                assert(groups.has(e.to), `${at}: edge to ${e.to}`)
              }
              for (const s of f.steps) {
                if (s.method === 'POST') assert(s.body, `${at}: ${s.id} has no body`)
                assert(!JSON.stringify(s.body ?? {}).includes('""'), `${at}: ${s.id} has an empty value`)
              }
              assert(f.groups.some((g) => g.id === 'g-dest'), `${at}: no destination`)
              // The agent prompt names every call and shows IDs as placeholders, not sample UUIDs.
              const p = prompt(f)
              for (const s of f.steps) if (s.path) assert(p.includes(s.path), `${at}: prompt misses ${s.path}`)
              assert(!/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(p.split('Steps, in order')[1]), `${at}: sample UUID in prompt`)
            }
        }

// Spot checks on the rules the docs set.
const rda = build(normalize({ ...DEFAULTS, src: 'USD', dst: 'INR' }))
assert('steps' in rda && rda.steps.some((s) => s.path === '/pos/api/v1/remittance-payout/initiate'))
assert('steps' in rda && rda.steps.find((s) => s.id === 'bank-create')?.body)
assert.equal(normalize({ ...DEFAULTS, src: 'INR', dst: 'INR' }).purpose, 'payout')
assert.equal(normalize({ ...DEFAULTS, src: 'USD', dst: 'INR', rail: 'UPI' }).rail, 'ACCOUNT_DETAILS')
assert.equal(normalize({ ...DEFAULTS, src: 'USDT', dst: 'INR', purpose: 'remittance' }).purpose, 'payout')
const pre = build(normalize({ ...DEFAULTS, src: 'USDT', dst: 'MXN', funding: 'prefunded' }))
assert('steps' in pre && !pre.steps.some((s) => (s.body as Record<string, unknown>)?.transaction_hash))
assert('unsupported' in build(normalize({ ...DEFAULTS, src: 'USDT', dst: 'USDC' })))

console.log(`ok: ${flows} flows`)
