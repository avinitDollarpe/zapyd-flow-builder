// Builds every source, destination and option combination and checks the
// flow is well formed. Run with `npm run check`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COINS, DEFAULTS, DESTINATIONS, MARKETS, SOURCES, build, choices, market, normalize, type Opts, type Step } from '../src/flow'
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
const pre = build(normalize({ ...DEFAULTS, src: 'USDT', dst: 'PHP', funding: 'prefunded' }))
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

// Zapyd pays out in exactly eight markets. The USA runs payins only.
const PAYOUT_MARKETS = ['AED', 'BDT', 'CNY', 'IDR', 'INR', 'NGN', 'PHP', 'VND']
assert.deepEqual(DESTINATIONS.filter((c) => market(c)).sort(), PAYOUT_MARKETS)
assert(SOURCES.includes('USD') && !DESTINATIONS.includes('USD') && market('USD')?.payin && !market('USD')?.rails.length)
assert('unsupported' in build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'USD' })))
assert('unsupported' in build(normalize({ ...DEFAULTS, src: 'INR', dst: 'USD' })))
// Every market takes a standard payout and a remittance payout, from any source.
// The remittance sender is always a remitter from kyc/remitter/create.
type Body = Record<string, unknown>
const bodyOf = (f: { steps: Step[] }, id: string) => f.steps.find((s) => s.id === id)?.body as Body | undefined
for (const dst of PAYOUT_MARKETS)
  for (const src of ['USDC', 'USD', 'INR'].filter((x) => x !== dst)) {
    const at = `${src}->${dst}`
    const pay = build(normalize({ ...DEFAULTS, src, dst, purpose: 'payout' }))
    assert('steps' in pay && pay.steps.some((s) => s.path === '/pos/api/v1/payout/initiate') && !pay.steps.some((s) => s.id === 'remitter-create'), at)
    assert.equal(normalize({ ...DEFAULTS, src, dst, purpose: 'remittance' }).purpose, 'remittance', at)
    const f = build(normalize({ ...DEFAULTS, src, dst, purpose: 'remittance' }))
    assert('steps' in f && f.steps.some((s) => s.path === '/pos/api/v1/remittance-payout/initiate'), at)
    assert(f.steps.some((s) => JSON.stringify(s.body ?? {}).includes('"capabilities":["REMITTANCE_PAYOUT"]')), at)
    const remitter = f.steps.find((s) => s.id === 'remitter-create')
    assert(remitter?.path === '/cms/api/v1/kyc/remitter/create', `${at}: no remitter`)
    for (const id of ['payout-quote', 'payout-initiate']) assert.equal(bodyOf(f, id)?.remitter_id, remitter.returns, `${at}: ${id} remitter_id`)
    // payment_method per fiat, the same for both payout APIs.
    const method = { INR: 'IMPS', BDT: 'MOBILE_WALLET' }[dst] ?? 'BANK_TRANSFER'
    assert.equal(bodyOf(f, 'payout-quote')?.payment_method, method, at)
    assert.equal(bodyOf(pay, 'payout-quote')?.payment_method, method, at)
  }
// India: IMPS to a bank account, for both APIs. No UPI payout.
assert.deepEqual(market('INR')!.rails.map((r) => r.method), ['ACCOUNT_DETAILS'])
// The remitter carries the fields its market needs, in the formats it checks.
const EXTRA: Record<string, string[]> = { AED: ['state', 'id_issued_country'] }
for (const fiat of ['VND', 'IDR', 'PHP', 'BDT']) EXTRA[fiat] = ['email', 'gender', 'occupation', 'state', 'postal_code', 'id_issued_country']
for (const fiat of PAYOUT_MARKETS) {
  const r = market(fiat)!.remitter!
  for (const k of ['first_name', 'last_name', 'nationality', 'city', 'source_of_funds', 'id_type', 'id_number', 'dob', 'phone', 'address_line', 'residence_country', ...(EXTRA[fiat] ?? [])])
    assert(r[k], `${fiat} remitter: no ${k}`)
  assert(r.residence_country !== 'IND' && /^\+\d{8,15}$/.test(r.phone), `${fiat} remitter`)
  if (r.gender) assert(['male', 'female', 'other'].includes(r.gender), `${fiat} remitter gender`)
}
assert.match(market('VND')!.remitter!.postal_code, /^\d{5}$/)
assert.match(market('PHP')!.remitter!.postal_code, /^\d{4}$/)
assert.equal(market('IDR')!.remitter!.id_type, 'PASSPORT')
// Samples pass the formats the docs list.
const sample = (fiat: string) => market(fiat)!.sample!
assert.match(sample('BDT').ids.account_number, /^01\d{9}$/)
assert(['BKASH', 'NAGAD', 'ROCKET'].includes(sample('BDT').ids.wallet_provider))
assert.match(sample('VND').ids.bank_code, /^\d{6}$/)
assert.match(sample('IDR').ids.bank_code, /^\d{3}$/)
for (const fiat of ['IDR', 'PHP']) assert.match(sample(fiat).ids.account_number, /^\d{10,16}$/)
for (const fiat of ['IDR', 'PHP']) assert.match(sample(fiat).ids.account_holder_name, /^[A-Za-z .]+$/)
for (const [fiat, n] of [['PHP', 4], ['VND', 5], ['IDR', 5], ['NGN', 6]] as const) assert.match(sample(fiat).address.postal_code, new RegExp(`^\\d{${n}}$`))
for (const k of ['beneficiary_native_first_name', 'beneficiary_native_last_name']) assert.match(sample('CNY').beneficiary[k], /^\p{Script=Han}+$/u)
// A remittance customer sends fewer fields: the remitter is the sender.
const bdRem = build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'BDT', purpose: 'remittance' }))
assert('steps' in bdRem && JSON.stringify(bodyOf(bdRem, 'ben-address')?.beneficiary_identifiers) === '{"beneficiary_nationality":"BGD"}')
assert(!('postal_code' in bodyOf(bdRem, 'ben-address')!))
const bdPay = build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'BDT' }))
assert('steps' in bdPay && (bodyOf(bdPay, 'ben-address')?.beneficiary_identifiers as Body)?.beneficiary_gender)
// Vietnam: the account is VERIFIED in the bank/create response.
const vn = build(normalize({ ...DEFAULTS, src: 'USDC', dst: 'VND', purpose: 'remittance' }))
assert('steps' in vn && !vn.steps.some((s) => s.id === 'bank-verified'))
// Every bank account is verified: the BANK webhook follows bank/create.
for (const f of [po, rem, pre, bdPay]) assert('steps' in f && f.steps.findIndex((s) => s.id === 'bank-verified') === f.steps.findIndex((s) => s.id === 'bank-create') + 1)

// The Rates page lights exactly the supported markets: its market list carries the same currencies as markets.json.
const ratesSrc = readFileSync(new URL('../public/rates/core.js', import.meta.url), 'utf8')
const ratesFiats = [...ratesSrc.matchAll(/^\s*M\('[A-Z]{2}', '[^']*', '([A-Z]{3})'/gm)].map((m) => m[1]).sort()
assert.deepEqual(ratesFiats, MARKETS.map((m) => m.fiat).sort(), 'public/rates/core.js markets differ from src/data/markets.json')
assert.match(ratesSrc, /M\('US', [^\n]*\{ payin: true, payout: false \}\)/, 'the Rates page shows the USA as payin only')

console.log(`ok: ${flows} flows`)
