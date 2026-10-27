// Builds every source, destination and option combination and checks the
// flow is well formed. Run with `npm run check`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
                // One set of onboarding calls for every flow: no payout-only routes, no purpose on the bank account.
                assert(!/\/(customer|bank|kyc)\/payout\/|add-kyc-data|remittance-beneficiary-kyc/.test(s.path ?? ''), `${at}: ${s.id} uses a removed route`)
                assert(!JSON.stringify(s.body ?? {}).includes('transfer_purpose'), `${at}: ${s.id} sends transfer_purpose`)
              }
              assert(f.groups.some((g) => g.id === 'g-dest'), `${at}: no destination`)
              // The agent prompt names every call and shows IDs as placeholders, not sample UUIDs.
              const p = prompt(f)
              for (const s of f.steps) if (s.path) assert(p.includes(s.path), `${at}: prompt misses ${s.path}`)
              assert(!/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/.test(p.split('Steps, in order')[1]), `${at}: sample UUID in prompt`)
            }
        }

// Spot checks on the rules the docs set.
// Fiat to INR offers both APIs: RDA when chosen, a standard payout otherwise.
const rda = build(normalize({ ...DEFAULTS, src: 'USD', dst: 'INR', purpose: 'remittance' }))
assert('steps' in rda && rda.steps.some((s) => s.path === '/pos/api/v1/remittance-payout/initiate'))
assert('steps' in rda && rda.steps.find((s) => s.id === 'bank-create')?.body)
const std = build(normalize({ ...DEFAULTS, src: 'USD', dst: 'INR', purpose: 'payout' }))
assert('steps' in std && std.steps.some((s) => s.path === '/pos/api/v1/payout/initiate'))
assert('steps' in std && !std.steps.some((s) => s.path?.includes('/remittance')))
assert.equal(normalize({ ...DEFAULTS, src: 'INR', dst: 'INR' }).purpose, 'payout')
assert.equal(normalize({ ...DEFAULTS, src: 'USD', dst: 'INR', purpose: 'remittance', rail: 'UPI' }).rail, 'ACCOUNT_DETAILS')
assert.equal(normalize({ ...DEFAULTS, src: 'USD', dst: 'INR', purpose: 'payout', rail: 'UPI' }).rail, 'ACCOUNT_DETAILS')
assert.equal(normalize({ ...DEFAULTS, src: 'USDT', dst: 'INR', purpose: 'remittance' }).purpose, 'remittance')
const pre = build(normalize({ ...DEFAULTS, src: 'USDT', dst: 'MXN', funding: 'prefunded' }))
assert('steps' in pre && !pre.steps.some((s) => (s.body as Record<string, unknown>)?.transaction_hash))
assert('steps' in pre && !pre.steps.some((s) => s.path?.includes('/prefunded/')))
assert('unsupported' in build(normalize({ ...DEFAULTS, src: 'USDT', dst: 'USDC' })))
assert.equal(normalize({ ...DEFAULTS, src: 'INR', dst: 'USDC' }).kyc, 'sharing')
assert.equal(normalize({ ...DEFAULTS, src: 'USD', dst: 'USDC' }).kyc, 'sdk')
// India: the beneficiary's capability follows the API. Normal payout sends the
// PAN and declarations; a remittance payout verifies with only customer_id. Bodies hold required fields only.
const po = build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'INR' }))
assert('steps' in po && po.steps.some((s) => JSON.stringify(s.body ?? {}).includes('"capabilities":["PAYOUT"]')))
assert('steps' in po && po.steps.some((s) => (s.body as Record<string, unknown>)?.income_range && (s.body as Record<string, unknown>)?.tax_number))
const rem = build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'INR', purpose: 'remittance' }))
assert('steps' in rem && rem.steps.some((s) => s.path?.endsWith('/remittance-payout/initiate')))
// India checks the account with the bank before adding it.
for (const f of [po, rem]) assert('steps' in f && f.steps.findIndex((s) => s.id === 'bank-validate') === f.steps.findIndex((s) => s.id === 'bank-create') - 1)
assert('steps' in rem && !rem.steps.some((s) => (s.body as Record<string, unknown>)?.income_range))
assert('steps' in rem && rem.steps.some((s) => JSON.stringify(s.body ?? {}).includes('"capabilities":["REMITTANCE_PAYOUT"]')))
assert('steps' in rem && rem.steps.some((s) => s.path?.endsWith('/kyc/add-data') && JSON.stringify(s.body) === JSON.stringify({ customer_id: s.body && (s.body as Record<string, unknown>).customer_id })))
for (const f of [po, rem]) assert('steps' in f && !f.steps.some((s) => (s.body as Record<string, unknown>)?.client_reference_id && s.id !== 'ben-create'))

// Remittance payouts work in every market. Outside India the sender is the
// customer who paid in, so the option needs a fiat source.
const mx = build(normalize({ ...DEFAULTS, src: 'USD', dst: 'MXN', purpose: 'remittance' }))
assert('steps' in mx && mx.steps.some((s) => s.path === '/pos/api/v1/remittance-payout/initiate'))
assert('steps' in mx && mx.steps.some((s) => JSON.stringify(s.body ?? {}).includes('"capabilities":["REMITTANCE_PAYOUT"]')))
assert('steps' in mx && !mx.steps.some((s) => s.id === 'remitter-create'))
const payerId = 'steps' in mx ? mx.steps.find((s) => s.id === 'payer-create')?.returns : undefined
assert('steps' in mx && mx.steps.filter((s) => (s.body as Record<string, unknown>)?.remitter_id).every((s) => (s.body as Record<string, unknown>).remitter_id === payerId))
assert.equal(normalize({ ...DEFAULTS, src: 'USDC', dst: 'MXN', purpose: 'remittance' }).purpose, 'payout')
// Vietnam: the remittance sender is a Create Remitter remitter, from any source,
// and the account is VERIFIED in the bank/create response.
const vn = build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'VND', purpose: 'remittance' }))
assert('steps' in vn && vn.steps.some((s) => s.id === 'remitter-create'))
assert('steps' in vn && vn.steps.filter((s) => (s.body as Record<string, unknown>)?.remitter_id).every((s) => (s.body as Record<string, unknown>).remitter_id === vn.steps.find((x) => x.id === 'remitter-create')?.returns))
assert('steps' in vn && !vn.steps.some((s) => s.id === 'bank-verified'))
// Every bank account is verified: the BANK webhook follows bank/create.
for (const f of [po, rem, mx, pre]) assert('steps' in f && f.steps.findIndex((s) => s.id === 'bank-verified') === f.steps.findIndex((s) => s.id === 'bank-create') + 1)

// The Rates page lights every supported market: its market list (the published rate card) carries every currency in markets.json.
const ratesSrc = readFileSync(new URL('../public/rates/core.js', import.meta.url), 'utf8')
const ratesFiats = new Set([...ratesSrc.matchAll(/^\s*M\('[A-Z]{2}', '[^']*', '([A-Z]{3})'/gm)].map((m) => m[1]))
for (const m of MARKETS) assert(ratesFiats.has(m.fiat), `public/rates/core.js has no market for ${m.fiat} from src/data/markets.json`)

console.log(`ok: ${flows} flows`)
