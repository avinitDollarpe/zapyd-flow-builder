// The UI preview: a sample end-user app in the middle and every Zapyd API call
// it makes on the right, with the request, the response and the webhooks.
// The journey is generic: sign up, verify email and phone (the phone's country
// is the KYC country), KYC for that country, pick a route on a calculator,
// review it, then run the flow.ts steps for that route. Nothing is sent: each
// response is the documented example from the API reference, filled in with
// the request's values.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Highlight, Rich } from './Code'
import RESPONSES from './data/responses.json'
import {
  DEFAULTS,
  DESTINATIONS,
  HOST,
  ID,
  NETWORKS,
  OFFERED_COINS,
  build,
  choices,
  coin,
  docsUrl,
  kindOf,
  market,
  normalize,
  pairFor,
  railName,
  stepFor,
  subtitle,
  type Flow,
  type Opts,
  type Side,
  type Step,
} from './flow'
import { Icon, Swap } from './icons'
import { useTheme } from './theme'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

const EMBED = new URLSearchParams(location.search).has('embed')

// ---------------------------------------------------------------- the user

interface Country {
  iso2: string
  name: string
  dial: string
  fiat: string
  alpha3: string
  sample: string
}
// Phone countries. Each maps to the market whose currency it uses; the
// Eurozone market is offered through a few of its countries.
const COUNTRIES: Country[] = [
  { iso2: 'in', name: 'India', dial: '+91', fiat: 'INR', alpha3: 'IND', sample: '98765 43210' },
  { iso2: 'us', name: 'United States', dial: '+1', fiat: 'USD', alpha3: 'USA', sample: '212 555 0123' },
  { iso2: 'gb', name: 'United Kingdom', dial: '+44', fiat: 'GBP', alpha3: 'GBR', sample: '7700 900123' },
  { iso2: 'ae', name: 'United Arab Emirates', dial: '+971', fiat: 'AED', alpha3: 'ARE', sample: '50 123 4567' },
  { iso2: 'sg', name: 'Singapore', dial: '+65', fiat: 'SGD', alpha3: 'SGP', sample: '8123 4567' },
  { iso2: 'hk', name: 'Hong Kong', dial: '+852', fiat: 'HKD', alpha3: 'HKG', sample: '5123 4567' },
  { iso2: 'cn', name: 'China', dial: '+86', fiat: 'CNY', alpha3: 'CHN', sample: '131 2345 6789' },
  { iso2: 'ph', name: 'Philippines', dial: '+63', fiat: 'PHP', alpha3: 'PHL', sample: '917 123 4567' },
  { iso2: 'ng', name: 'Nigeria', dial: '+234', fiat: 'NGN', alpha3: 'NGA', sample: '802 123 4567' },
  { iso2: 'mx', name: 'Mexico', dial: '+52', fiat: 'MXN', alpha3: 'MEX', sample: '55 1234 5678' },
  { iso2: 'br', name: 'Brazil', dial: '+55', fiat: 'BRL', alpha3: 'BRA', sample: '11 91234 5678' },
  { iso2: 'co', name: 'Colombia', dial: '+57', fiat: 'COP', alpha3: 'COL', sample: '300 123 4567' },
  { iso2: 'de', name: 'Germany', dial: '+49', fiat: 'EUR', alpha3: 'DEU', sample: '1512 3456789' },
  { iso2: 'fr', name: 'France', dial: '+33', fiat: 'EUR', alpha3: 'FRA', sample: '6 12 34 56 78' },
  { iso2: 'es', name: 'Spain', dial: '+34', fiat: 'EUR', alpha3: 'ESP', sample: '612 34 56 78' },
  { iso2: 'it', name: 'Italy', dial: '+39', fiat: 'EUR', alpha3: 'ITA', sample: '312 345 6789' },
  { iso2: 'nl', name: 'Netherlands', dial: '+31', fiat: 'EUR', alpha3: 'NLD', sample: '6 12345678' },
]

interface User {
  name: string
  email: string
  country: Country
  phone: string
}
const NEW_USER: User = { name: 'Alex Morgan', email: 'alex@example.com', country: COUNTRIES[0], phone: COUNTRIES[0].sample }

// Countries whose currency has payins get full KYC through the hosted flow;
// the rest use payout-only onboarding (an address, no documents).
const fullKyc = (c: Country) => !!market(c.fiat)?.payin
const sourcesFor = (c: Country) => [...OFFERED_COINS, ...(fullKyc(c) ? [c.fiat] : [])]

function startOpts(c: Country): Opts {
  const o = fullKyc(c) ? { src: c.fiat, dst: 'USDC' } : { src: 'USDC', dst: c.fiat }
  return normalize({ ...DEFAULTS, ...o, payinMethod: c.fiat === 'USD' ? 'WIRE' : '' })
}
const START_AMOUNT: Record<string, string> = { INR: '10000', USD: '1000' }
const startAmount = (src: string) => START_AMOUNT[src] ?? '100'

const Flag = ({ c, size = 20 }: { c: Country; size?: number }) => <img className="flag" src={`/flags/${c.iso2}.svg`} width={size} height={size} alt="" />

// ---------------------------------------------------------------- the journey

type Phase = 'signup' | 'kyc' | 'route' | 'transfer'
const PHASES: { id: Phase; title: string }[] = [
  { id: 'signup', title: 'Sign up' },
  { id: 'kyc', title: 'Identity' },
  { id: 'route', title: 'Choose a route' },
  { id: 'transfer', title: 'Transfer' },
]
type Ui = 'signup' | 'email-otp' | 'phone' | 'phone-otp' | 'kyc-start' | 'kyc-pan' | 'kyc-doc' | 'kyc-check' | 'kyc-selfie' | 'kyc-address' | 'kyc-done' | 'calc' | 'preview'
interface JStep extends Step {
  phase: Phase
  // A screen of its own; flow.ts steps without one use the generic screen.
  ui?: Ui
  // Runs inside Zapyd's hosted KYC page rather than your app.
  hosted?: boolean
}

const app = (id: string, ui: Ui, phase: Phase, title: string, text: string, extra: Partial<JStep> = {}): JStep => ({ n: 0, id, ui, phase, kind: 'info', title, text, ...extra })

// The sandbox shortcut for the second KYC button.
const MOCK_KYC: Step = {
  n: 0,
  id: 'kyc-mock',
  kind: 'api',
  title: 'Mock the KYC result',
  text: '',
  method: 'POST',
  path: '/cms/api/v1/kyc/mock-kyc-status',
  docs: '/api-reference-exchange/endpoint/kyc/mock-kyc-status',
}

function onboarding(u: User): JStep[] {
  const c = u.country
  const full = fullKyc(c)
  const phone = `${c.dial}${u.phone.replace(/\D/g, '')}`
  const steps: JStep[] = [
    app('signup', 'signup', 'signup', 'Name and email', 'Your app collects these. Nothing is sent to Zapyd yet.'),
    app('email-otp', 'email-otp', 'signup', 'Verify the email', 'Your app sends and checks this code. Zapyd isn\'t involved.'),
    app('phone', 'phone', 'signup', 'Phone number', `The phone's country is the user's KYC country. ${c.name} ${full ? 'runs full KYC through the hosted flow' : 'uses payout-only onboarding'}.`),
    {
      n: 0,
      id: 'payer-create',
      ui: 'phone-otp',
      phase: 'signup',
      kind: 'api',
      title: 'Create the customer',
      text: `Once the phone is verified, your backend registers the user with Zapyd. Save the returned \`id\` as \`customer_id\`.${full ? '' : ' Payout-only onboarding must be enabled for your organization and the country.'}`,
      method: 'POST',
      path: full ? '/cms/api/v1/customer/create' : '/cms/api/v1/customer/payout/create',
      body: {
        client_reference_id: 'user-001',
        full_name: u.name,
        email: u.email,
        phone,
        alpha_3_country_code: c.alpha3,
        ...(c.fiat === 'USD' ? { dob: '1990-01-15' } : {}),
      },
      returns: ID.payer,
      docs: full ? '/api-reference-exchange/endpoint/customer/create' : '/guides/customers/payout-only-onboarding',
    },
  ]
  if (full) {
    steps.push({
      n: 0,
      id: 'payer-kyc',
      ui: 'kyc-start',
      phase: 'kyc',
      kind: 'api',
      title: 'Generate a KYC link',
      text: 'Your app opens the returned `url`, Zapyd\'s hosted KYC flow. In sandbox you can skip it with Mock KYC Status.',
      method: 'POST',
      path: '/cms/api/v1/kyc/generate-link',
      body: { customer_id: ID.payer, redirect_url: 'https://yourapp.com/kyc/return' },
      docs: '/guides/customers/kyc-sdk',
    })
    const india = c.fiat === 'INR'
    if (india) steps.push(app('kyc-pan', 'kyc-pan', 'kyc', 'PAN', 'Hosted by Zapyd. The PAN must be valid, belong to an individual, match the name and date of birth, and be linked to an Aadhaar.', { hosted: true }))
    steps.push(
      app('kyc-doc', 'kyc-doc', 'kyc', 'Identity document', india ? 'Hosted by Zapyd. Aadhaar is verified with an OTP through DigiLocker, so there\'s nothing to upload. A passport is uploaded, front and back.' : 'Hosted by Zapyd. The user picks a document and photographs it.', { hosted: true }),
      app('kyc-check', 'kyc-check', 'kyc', 'Document check', 'Hosted by Zapyd. Forgery checks and OCR, then the details are matched.', { hosted: true }),
      app('kyc-selfie', 'kyc-selfie', 'kyc', 'Liveness and face match', 'Hosted by Zapyd. A live selfie, matched with the document. Allow camera access if you embed the flow in a webview.', { hosted: true }),
      {
        n: 0,
        id: 'payer-verified',
        phase: 'kyc',
        kind: 'event',
        title: 'Wait for VERIFIED',
        text: 'The `CUSTOMER` webhook reports `VERIFIED`. Arriving at `redirect_url` doesn\'t mean the user passed, so wait for the webhook.',
        docs: '/guides/development-and-testing/webhooks',
      },
    )
  } else {
    const m = market(c.fiat)!
    steps.push(
      {
        n: 0,
        id: 'payer-kyc',
        ui: 'kyc-start',
        phase: 'kyc',
        kind: 'api',
        title: 'Create the KYC profile',
        text: 'Creates the user\'s payout KYC record. No documents are needed.',
        method: 'POST',
        path: '/cms/api/v1/kyc/payout/add-kyc-data',
        body: { customer_id: ID.payer },
        docs: '/api-reference-exchange/endpoint/kyc/payout-add-kyc-data',
      },
      {
        n: 0,
        id: 'payer-address',
        ui: 'kyc-address',
        phase: 'kyc',
        kind: 'api',
        title: 'Add the address',
        text: `${c.name} needs ${m.address.map((a) => `\`${a}\``).join(', ')}.`,
        method: 'POST',
        path: '/cms/api/v1/kyc/payout/add-sender-kyc-data',
        body: { client_reference_id: 'user-001', country_code: c.alpha3, ...m.sample!.address },
        docs: '/api-reference-exchange/endpoint/kyc/payout-add-sender-kyc-data',
      },
      app('kyc-done', 'kyc-done', 'kyc', 'Ready for payouts', 'The user can now receive payouts. They never upload a document.'),
    )
  }
  return steps
}

// The route's flow.ts steps, minus what onboarding already did: the paying
// customer, and the beneficiary when the money goes to the user's own country.
function transfer(o: Opts, u: User): { flow?: Flow; steps: JStep[] } {
  const f = build(o)
  if ('unsupported' in f) return { steps: [] }
  const self = o.dst === u.country.fiat
  const ben = f.steps.find((s) => s.id === 'ben-create')?.returns
  const swap = (body: unknown) => {
    const s = JSON.stringify(body)
    return JSON.parse(self && ben ? s.replaceAll(`"${ben}"`, `"${ID.payer}"`) : s)
  }
  const steps = f.steps
    .filter((s) => !s.id.startsWith('payer-') && !(self && s.id.startsWith('ben-')))
    .map((s): JStep => ({ ...s, phase: 'transfer', body: s.body && swap(s.body) }))
  return { flow: f, steps }
}

// ---------------------------------------------------------------- rates and samples

// ponytail: indicative USD rates so quotes look right; not live. Fine for a demo.
const RATE: Record<string, number> = {
  USD: 1, INR: 88.2, MXN: 18.35, BRL: 5.32, EUR: 0.857, GBP: 0.745, COP: 3870, PHP: 57.9, NGN: 1480, SGD: 1.29, AED: 3.6725, HKD: 7.78, CNY: 7.12,
}
const WALLET: Record<string, string> = {
  tron: 'TXqH4MnDw46f3yyrRwau3JF92Y1ie3pAXf',
  solana: 'Hx8d2ZpYd9QmTqW3vR7nKc5sLbF4gJ6eA1uXyN2tMoP',
  evm: '0x7a3f9c2e1b8d4f6a5c0e9b2d7f1a3c5e8b4d6f2a',
}
const walletFor = (net: string) => WALLET[net] ?? WALLET.evm

const bytes = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)))
const hex = (n: number) => bytes(n).map((b) => b.toString(16).padStart(2, '0')).join('')
const digits = (n: number) => bytes(n).map((b) => b % 10).join('')
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const txHash = (net: string) => (net === 'solana' ? bytes(88).map((b) => B58[b % 58]).join('') : net === 'tron' ? hex(32) : '0x' + hex(32))
const now = (ms = 0) => new Date(Date.now() + ms).toISOString().replace(/\.\d+Z$/, 'Z')

const money = (v: unknown, code: string) => {
  const n = Number(v)
  return market(code)
    ? n.toLocaleString('en-US', { style: 'currency', currency: code, maximumFractionDigits: 2 })
    : `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${code}`
}

interface Ctx {
  o: Opts
  flow: Flow
  asset: string
  // Response `data` and webhook payloads, by step id.
  data: Record<string, Json>
  user: User
  // What the calculator says the user sends.
  amount: string
}

// ---------------------------------------------------------------- requests

// Fields the end user never types: IDs, routing and compliance values your
// backend fills in. They still appear in the request on the right.
const HIDDEN = new Set([
  'customer_id', 'bank_id', 'remitter_id', 'quotation_id', 'client_reference_id', 'redirect_url', 'risk_parameters', 'customer',
  'asset', 'fiat', 'network', 'payment_method', 'bank_account_type', 'is_self_transfer', 'transfer_purpose', 'transaction_hash',
  'selfie_url', 'registered_date', 'alpha_3_country_code', 'country_code', 'document_type', 'nationality', 'residence_country', 'source_of_funds', 'id_type',
])
const WORD: Record<string, string> = {
  id: 'ID', ifsc: 'IFSC', vpa: 'UPI ID', mx: '', br: '', clabe: 'CLABE', cpf: 'CPF', swift: 'SWIFT', dob: 'date of birth', utr: 'UTR', pan: 'PAN', doc: 'document',
}
const LABEL: Record<string, string> = {
  transaction_reference_id: 'Bank reference (UTR)',
  tax_number: 'Tax ID',
  full_address: 'Address',
  document_number: 'ID document number',
  sending_amount: 'Amount',
  receiving_amount: 'Recipient gets',
  street: 'Street',
  id_number: 'Passport number',
  narrative: 'Reference to include',
}
const label = (path: string) => {
  const k = path.split('.').pop()!
  if (LABEL[k]) return LABEL[k]
  const s = k.split('_').map((w) => WORD[w] ?? w).filter(Boolean).join(' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function fields(body: Json, prefix = ''): [string, string][] {
  return Object.entries(body).flatMap(([k, v]): [string, string][] =>
    HIDDEN.has(k) || typeof v === 'boolean' ? [] : v && typeof v === 'object' ? fields(v, `${prefix}${k}.`) : [[prefix + k, String(v)]],
  )
}

function request(st: Step, edits: Record<string, string> = {}, hash = ''): Json | undefined {
  if (!st.body) return undefined
  const body = structuredClone(st.body) as Json
  for (const [path, v] of Object.entries(edits)) {
    const ks = path.split('.')
    const last = ks.pop()!
    ks.reduce((a, k) => a[k], body)[last] = v
  }
  if ('transaction_hash' in body) body.transaction_hash = hash
  return body
}

// ---------------------------------------------------------------- responses

function respond(st: Step, body: Json = {}, c: Ctx): Json {
  const path = st.path!.replace(/^\/\w+\/api\/v1/, '')
  const res = structuredClone((RESPONSES as Record<string, Json>)[path])
  const d: Json = res.data
  const payin = path.startsWith('/payin')
  const fiat = payin ? c.o.src : c.o.dst
  const quote = c.data[payin ? 'payin-quote' : 'payout-quote']
  const initiate = path.endsWith('/initiate')

  if (initiate && quote) for (const k of Object.keys(d)) if (k in quote && k !== 'id' && k !== 'created_at') d[k] = quote[k]
  for (const [k, v] of Object.entries(body)) if (k in d) d[k] = v
  if ('asset' in d) d.asset = c.asset
  if ('fiat' in d) d.fiat = fiat
  if ('network' in d) d.network = c.o.network
  if (d.fees) d.fees = Object.fromEntries(Object.entries(d.fees).map(([k, v]) => [k, typeof v === 'number' ? 0 : '0.00']))

  if (path.endsWith('/quotation')) {
    const rate = RATE[fiat] ?? 1
    d.rate = String(rate)
    if (payin) d.receiving_amount = (Number(d.sending_amount) / rate).toFixed(2)
    else if (body.receiving_amount) d.sending_amount = (Number(body.receiving_amount) / rate).toFixed(2)
    else d.receiving_amount = (Number(d.sending_amount) * rate).toFixed(2)
    d.sending_amount = Number(d.sending_amount).toFixed(2)
    d.receiving_amount = Number(d.receiving_amount).toFixed(2)
    d.created_at = now()
    d.expiry_time = now(10 * 60e3)
    if ('wallet_address' in d) d.wallet_address = walletFor(c.o.network)
    if (payin) {
      if (c.o.payinMethod === 'ACH_PULL') delete d.deposit_instructions
      else if (fiat === 'USD')
        d.deposit_instructions = {
          account_number: '000123456789',
          routing_number: '123456789',
          bank_name: 'Sandbox Bank',
          bank_address: '1 Sandbox Way, New York, NY 10001',
          account_holder_name: 'Zapyd Sandbox',
          narrative: `ZPD${digits(8)}`,
        }
      else if (c.o.payinMethod === 'UPI') d.deposit_instructions.deep_link = d.deposit_instructions.deep_link.replace(/am=\d+/, `am=${body.sending_amount}`)
      else {
        delete d.deposit_instructions.deep_link
        delete d.deposit_instructions.ios_checkout_link
      }
    }
  }
  if (initiate) {
    d.quotation_id = quote?.id
    d.status = 'PROCESSING'
    d.created_at = now()
    if ('updated_at' in d) d.updated_at = now()
    if (payin) d.wallet_address = walletFor(c.o.network)
    for (const k of ['transaction_hash', 'utr', 'transaction_reference_id']) if (k in d && !(k in body)) d[k] = null
  }

  if (path.startsWith('/customer')) {
    d.country = body.alpha_3_country_code
    d.status = 'UNVERIFIED'
    for (const k of ['email', 'phone', 'document_type']) if (!(k in body)) d[k] = null
  }
  if (path.includes('bank/')) {
    d.country = market(c.o.dst)!.alpha3
    d.beneficiary_name = String(c.data['ben-create']?.full_name ?? c.user.name).toUpperCase()
    d.bank_name = body.identifiers?.bank_name ?? null
    d.bank_account_status = c.flow.steps.some((s) => s.id === 'bank-verified') ? 'PROCESSING' : 'VERIFIED'
  }
  if (path === '/kyc/remitter/create') {
    d.full_name = `${body.first_name} ${body.last_name}`
    d.email = null
    d.document_type = body.id_type
    d.created_at = now().replace('Z', '+00:00')
  }
  if (path === '/payout/balance') d.available_balance = { [c.asset]: '15000.50' }
  if (path === '/kyc/generate-link') d.url = `https://app.zapyd.com/kyc?kyc_id=${crypto.randomUUID()}`

  if (path === '/kyc/mock-kyc-status') d.status = body.kyc_status
  d.id = st.returns ?? (path.endsWith('add-kyc-data') || path === '/kyc/mock-kyc-status' ? body.customer_id : crypto.randomUUID())
  return res
}

const HOOKS: Record<string, { type: string; event: string; from: string }> = {
  'payer-verified': { type: 'CUSTOMER', event: 'VERIFIED', from: 'payer-create' },
  'bank-verified': { type: 'BANK', event: 'VERIFIED', from: 'bank-create' },
  'payin-success': { type: 'PAYIN', event: 'SUCCESS', from: 'payin-initiate' },
  'payout-success': { type: 'PAYOUT', event: 'SUCCESS', from: 'payout-initiate' },
}

function webhook(st: Step, c: Ctx): Json {
  const h = HOOKS[st.id]
  const src = c.data[h.from] ?? {}
  const metadata =
    h.type === 'PAYIN'
      ? { ...(src.transaction_reference_id ? { transaction_reference_id: src.transaction_reference_id } : {}), transaction_hash: txHash(c.o.network) }
      : h.type === 'PAYOUT'
        ? { client_reference_id: src.client_reference_id, ...(c.o.dst === 'INR' ? { utr: digits(12) } : {}) }
        : {}
  return { type: h.type, id: src.id, event: h.event, timestamp: now(), metadata }
}

// ---------------------------------------------------------------- screens

interface Copy {
  title: string
  sub?: string
  cta: string
  // Event steps: the headline once the webhook lands.
  done?: string
}

function copy(st: Step, c: Ctx): Copy {
  const { o, asset } = c
  const pq = c.data['payin-quote']
  const oq = c.data['payout-quote']
  const net = NETWORKS[o.network] ?? o.network
  const sm = market(o.src)
  const dm = market(o.dst)
  const verify = (who: string): Copy =>
    o.kyc === 'sharing'
      ? { title: `Confirm ${who} identity`, sub: 'Details you already verified are shared with Zapyd.', cta: 'Submit' }
      : { title: `Verify ${who} identity`, sub: 'Takes about two minutes with an ID document.', cta: 'Start verification' }
  switch (st.id) {
    case 'payer-create':
      return { title: 'Your details', sub: dm ? 'You, the person sending the money.' : 'Tell us who is buying.', cta: 'Continue' }
    case 'payer-kyc':
      return verify('your')
    case 'payer-verified':
      return { title: 'Checking your identity', done: "You're verified", cta: 'Continue' }
    case 'payin-link':
      return { title: 'Link your bank account', sub: 'Sign in to your bank and choose the account to pay from.', cta: 'Link account' }
    case 'payin-quote':
      return { title: 'Lock the rate', sub: `${money(c.amount, o.src)} via ${railName(o.payinMethod)}, as you chose. The quote holds the rate for 10 minutes.`, cta: 'Get a quote' }
    case 'payin-pay':
      return { title: `Pay ${money(pq?.sending_amount, o.src)}`, sub: 'Send exactly this amount, from a bank account in your name, before the quote expires.', cta: "I've paid" }
    case 'payin-initiate':
      return { title: 'Confirm your payment', sub: sm?.payin?.reference === 'required' ? 'Enter the 12-digit UTR your bank gave you.' : undefined, cta: 'Confirm payment' }
    case 'payin-success':
      return { title: 'Waiting for your payment', done: dm ? 'Payment received' : `${money(pq?.receiving_amount, asset)} delivered`, cta: dm ? 'Continue' : 'Finish' }
    case 'ben-create':
      return { title: sm ? 'Who are you sending to?' : 'Who gets the money?', sub: `The holder of the bank account in ${dm!.country}.`, cta: 'Continue' }
    case 'ben-kyc':
      if (st.path?.includes('remittance')) return { title: 'Recipient check', sub: 'A light check on the person receiving the money.', cta: 'Submit' }
      if (st.path?.includes('/payout/')) return { title: 'Recipient profile', sub: 'No documents needed.', cta: 'Continue' }
      return verify("the recipient's")
    case 'ben-address':
      return { title: 'Recipient address', cta: 'Continue' }
    case 'bank-create':
      return { title: 'Bank account', sub: `${railName(o.rail)} in ${dm!.country}.`, cta: 'Add account' }
    case 'bank-verified':
      return { title: 'Verifying the account', done: 'Account verified', cta: 'Continue' }
    case 'remitter-create':
      return { title: 'Sender details', sub: 'The person sending the money, who lives outside India.', cta: 'Continue' }
    case 'payout-quote':
      return {
        title: 'Lock the rate',
        sub: sm ? `The ${asset} your payin delivered now funds the ${dm!.currency} payout.` : `${asset} to convert to ${dm!.currency}, as you chose.`,
        cta: 'Get a quote',
      }
    case 'payout-balance':
      return { title: 'Review', sub: 'Paid from your prefunded balance.', cta: 'Continue' }
    case 'payout-send':
      return { title: `Send ${asset}`, sub: `Your app sends exactly this amount on ${net} to the quoted address.`, cta: `Send ${asset}` }
    case 'payout-initiate':
      return { title: 'Confirm transfer', cta: `Send ${money(oq?.receiving_amount, o.dst)}` }
    case 'payout-success':
      return { title: 'Sending the money', done: `${money(oq?.receiving_amount, o.dst)} delivered`, cta: 'Finish' }
  }
  return { title: st.title, cta: 'Continue' }
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

const Ok = () => (
  <span className="kok" aria-hidden="true">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  </span>
)

// Pending ring and success check, cross-faded like the KYC demo.
const Check = ({ done, children }: { done?: boolean; children: React.ReactNode }) => (
  <div className={`kcheck${done ? ' is-done' : ''}`}>
    <span className="kcheck-icon" aria-hidden="true">
      <svg className="kic-wait" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="8" strokeDasharray="2.5 3" />
      </svg>
      <svg className="kic-done" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 4.5-5" />
      </svg>
    </span>
    {children}
  </div>
)

const StatusIcons = () => (
  <span className="ksicons">
    <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
      <rect x="0" y="7" width="3" height="4" rx="1" />
      <rect x="4.5" y="4.5" width="3" height="6.5" rx="1" />
      <rect x="9" y="2" width="3" height="9" rx="1" />
      <rect x="13.5" y="0" width="3" height="11" rx="1" opacity="0.3" />
    </svg>
    <svg width="15" height="11" viewBox="0 0 15 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7.5" cy="9.5" r="1.25" fill="currentColor" stroke="none" />
      <path d="M4.6 6.8a4.2 4.2 0 0 1 5.8 0" />
      <path d="M2 4.2a7.8 7.8 0 0 1 11 0" />
    </svg>
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
      <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" />
      <path d="M23 4v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity="0.4" />
    </svg>
  </span>
)

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="kcard">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function QuoteSummary({ q, payin }: { q?: Json; payin: boolean }) {
  if (!q) return null
  const [from, to] = payin ? [q.fiat, q.asset] : [q.asset, q.fiat]
  return (
    <Rows
      rows={[
        ['You send', money(q.sending_amount, from)],
        ['They get', money(q.receiving_amount, to)],
        ['Rate', `1 ${q.asset} = ${q.rate} ${q.fiat}`],
        ['Fees', money(0, from)],
        ['Quote expires', new Date(q.expiry_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })],
      ]}
    />
  )
}

// ---------------------------------------------------------------- console

interface Entry {
  key: string
  step: Step
  kind: 'api' | 'event' | 'action'
  req?: Json
  res?: Json
  ms?: number
  at: string
  note?: string
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre>
      <code>
        <Highlight code={JSON.stringify(value, null, 2)} />
      </code>
    </pre>
  )
}

function LogEntry({ e, open, onToggle }: { e: Entry; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLLIElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    el.scrollIntoView({ block: 'nearest' })
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' })
  }, [])
  if (e.kind === 'action')
    return (
      <li ref={ref} className="log-note">
        <Icon name={LOG_ICON[e.step.id] ?? 'check'} size={14} />
        <span>{e.note}</span>
        <time>{e.at}</time>
      </li>
    )
  const hook = e.kind === 'event'
  return (
    <li ref={ref} className={`log${open ? ' open' : ''}`}>
      <button className="log-head" aria-expanded={open} onClick={onToggle}>
        {hook ? <span className="kind-chip kind-event">Webhook</span> : <b className={`verb verb-${e.step.method}`}>{e.step.method}</b>}
        <span className="log-path">{hook ? `${e.res!.type} · ${e.res!.event}` : e.step.path}</span>
        {!hook && <span className="log-status">200</span>}
        <span className="log-ms">{hook ? e.at : `${e.ms} ms`}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div className="log-body">
          {hook ? (
            <div className="block">
              <div className="block-head">
                <span>POST https://yourapp.com/webhooks/zapyd</span>
              </div>
              <JsonBlock value={e.res} />
            </div>
          ) : (
            <>
              {e.req && (
                <div className="block">
                  <div className="block-head">
                    <span>Request</span>
                    {e.step.docs && (
                      <a className="icon-btn" href={docsUrl(e.step.docs)} target="_blank" rel="noreferrer" aria-label="Open in the API reference" title="Open in the API reference">
                        <Icon name="book" size={14} />
                      </a>
                    )}
                  </div>
                  <JsonBlock value={e.req} />
                </div>
              )}
              <div className="block">
                <div className="block-head">
                  <span>
                    Response <span className="log-status">200 OK</span>
                  </span>
                  {!e.req && e.step.docs && (
                    <a className="icon-btn" href={docsUrl(e.step.docs)} target="_blank" rel="noreferrer" aria-label="Open in the API reference" title="Open in the API reference">
                      <Icon name="book" size={14} />
                    </a>
                  )}
                </div>
                <JsonBlock value={e.res} />
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------- demo

const LOG_ICON: Partial<Record<string, string>> = {
  signup: 'user-plus',
  'email-otp': 'shield',
  phone: 'shield',
  'kyc-pan': 'id-card',
  'kyc-doc': 'id-card',
  'kyc-check': 'id-card',
  'kyc-selfie': 'id-card',
  'payin-link': 'landmark',
  'payin-pay': 'banknote',
  'payout-send': 'send',
}
const KIND_SHORT: Record<ReturnType<typeof kindOf>, string> = { onramp: 'Onramp', offramp: 'Offramp', remittance: 'Cross-border', unsupported: '' }
const KIND_TEXT: Record<ReturnType<typeof kindOf>, string> = {
  offramp: 'Offramp · stablecoins to a bank account',
  onramp: 'Onramp · bank transfer to stablecoins',
  remittance: 'Cross-border · fiat to fiat through stablecoins',
  unsupported: 'Pick a different pair',
}
const usdOf = (amount: number, code: string) => (market(code) ? amount / (RATE[code] ?? 1) : amount)
const convert = (amount: number, src: string, dst: string) => {
  const usd = usdOf(amount, src)
  return market(dst) ? usd * (RATE[dst] ?? 1) : usd
}

export default function Demo() {
  const [theme, setTheme] = useTheme()
  const [user, setUser] = useState<User>(NEW_USER)
  const [o, setO] = useState<Opts>(() => startOpts(NEW_USER.country))
  const [amount, setAmount] = useState(() => startAmount(startOpts(NEW_USER.country).src))

  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<Entry[]>([])
  const [data, setData] = useState<Record<string, Json>>({})
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({})
  const [hash, setHash] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // Steps the sandbox shortcut jumped over.
  const seq = useRef(0)
  // Bumped on restart, so a call in flight doesn't land in the new run.
  const epoch = useRef(0)
  const dataRef = useRef(data)
  dataRef.current = data

  const route = useMemo(() => transfer(o, user), [o, user])
  const flow = route.flow
  const steps = useMemo<JStep[]>(
    () => [
      ...onboarding(user),
      app('calc', 'calc', 'route', 'Pick what to send', 'The source is the user\'s own currency, when it has payins, or a stablecoin. The destination is any stablecoin or payout currency. Pickers work like the Flow Builder.'),
      app('preview', 'preview', 'route', 'Review', 'A summary before any money moves. Every step after this one is a Zapyd call, a user action or a webhook.'),
      ...route.steps,
    ],
    [user, route],
  )
  const asset = coin(o.src) ? o.src : coin(o.dst) ? o.dst : o.bridge
  const c: Ctx = { o, flow: flow ?? ({ steps: [] } as unknown as Flow), asset, data, user, amount }
  const st = steps[i] as JStep | undefined
  const finished = i >= steps.length
  const at = (id: string) => steps.findIndex((s) => s.id === id)
  const calcAt = at('calc')
  const locked = i > at('preview') // the route can't change once the transfer starts

  // Quote amounts start from the calculator, and a cross-border payout from
  // the USDC the payin delivered.
  const editsFor = (s: Step): Record<string, string> => {
    const body = s.body as Json | undefined
    const own = edits[s.id] ?? {}
    if (!body) return own
    if (s.id === 'payin-quote') return { sending_amount: amount, ...own }
    if (s.id === 'remitter-create') {
      const [first, ...last] = user.name.trim().split(/\s+/)
      return { first_name: first, last_name: last.join(' ') || first, ...own }
    }
    if (s.id !== 'payout-quote') return own
    const usdc = Number(data['payin-quote']?.receiving_amount ?? usdOf(Number(amount), o.src))
    const start: Record<string, string> = 'receiving_amount' in body ? { receiving_amount: String(Math.floor(usdc * (RATE[o.dst] ?? 1))) } : { sending_amount: usdc.toFixed(2) }
    return { ...start, ...own }
  }

  const reset = () => {
    epoch.current++
    setUser(NEW_USER)
    setO(startOpts(NEW_USER.country))
    setAmount(startAmount(startOpts(NEW_USER.country).src))
    setI(0)
    setBusy(false)
    setLog([])
    setData({})
    setEdits({})
    setHash('')
    setOpen({})
  }

  const push = (e: Omit<Entry, 'key' | 'at'>) => {
    const key = `${e.step.id}-${seq.current++}`
    setLog((l) => [...l, { ...e, key, at: new Date().toLocaleTimeString('en-US', { hour12: false }) }])
    setOpen({ [key]: true })
  }
  const note = (s: Step, text: string) => push({ step: s, kind: 'action', note: text })

  // A Zapyd call, after a short, realistic latency. Resolves null when the
  // demo restarted meanwhile.
  const call = (s: Step, body = request(s, editsFor(s), hash)) =>
    new Promise<Json | null>((resolve) => {
      const ms = 120 + Math.round(Math.random() * 260)
      const run = epoch.current
      setTimeout(() => {
        if (epoch.current !== run) return resolve(null)
        const res = respond(s, body, { ...c, data: dataRef.current })
        dataRef.current = { ...dataRef.current, [s.id]: res.data }
        setData(dataRef.current)
        push({ step: s, kind: 'api', req: body, res, ms })
        resolve(res)
      }, ms)
    })

  const next = async (alt = false) => {
    if (!st || busy) return
    if (st.kind === 'event') return setI(i + 1)
    if (st.kind === 'api') {
      setBusy(true)
      const run = epoch.current
      if (st.ui === 'phone-otp') note(st, `Phone ${user.country.dial} ${user.phone} verified by your app.`)
      if (st.ui === 'kyc-start' && alt && fullKyc(user.country)) {
        // Sandbox: set the result instead of running the hosted flow.
        if (!(await call(MOCK_KYC, { customer_id: ID.payer, kyc_status: 'VERIFIED' }))) return
        setBusy(false)
        return setI(at('payer-verified'))
      }
      if (!(await call(st))) return
      if (st.ui === 'kyc-start' && alt) {
        // Payout-only: fill the address with the market's sample.
        const addr = steps[at('payer-address')]
        if (!(await call(addr))) return
        setBusy(false)
        return setI(at('kyc-done'))
      }
      if (epoch.current !== run) return
      setBusy(false)
      return setI(i + 1)
    }
    // No Zapyd call: your app's own screens, the hosted KYC pages and user actions.
    if (st.id === 'payout-send') {
      const h = txHash(o.network)
      setHash(h)
      note(st, `Sent ${money(data['payout-quote']?.sending_amount, asset)} on ${NETWORKS[o.network]} · ${h.slice(0, 10)}…`)
    } else if (st.id === 'payin-pay') note(st, `User paid ${money(data['payin-quote']?.sending_amount, o.src)} via ${railName(o.payinMethod)}. Not an API call.`)
    else if (st.id === 'payin-link') note(st, 'User linked their bank account on the hosted page. Not an API call.')
    else if (st.id === 'signup') note(st, `${user.name} · ${user.email}. Kept by your app for now.`)
    else if (st.id === 'email-otp') note(st, 'Email verified by your app. Not a Zapyd call.')
    else if (st.hosted) note(st, `Hosted KYC · ${st.title} done, inside Zapyd's flow.`)
    else if (st.id === 'preview') note(st, `Route confirmed: ${money(amount, o.src)} ${o.src === o.dst ? '' : `to ${o.dst}`}.`)
    setI(i + 1)
  }

  // Webhooks land on their own, a moment after the screen opens.
  useEffect(() => {
    if (!st || st.kind !== 'event' || data[st.id]) return
    const t = setTimeout(() => {
      const res = webhook(st, c)
      setData((d) => ({ ...d, [st.id]: res }))
      push({ step: st, kind: 'event', res })
    }, 1400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, data])


  const setCountry = (country: Country) => {
    setUser((u) => ({ ...u, country, phone: country.sample }))
    const so = startOpts(country)
    setO(so)
    setAmount(startAmount(so.src))
  }
  // A pick locks the code and its method together, then the pair is made valid
  // for this user: their own currency or a stablecoin as the source.
  const commit = (side: Side, code: string, method: string) => {
    const p: Opts = { ...o, ...pairFor(o, side, code) }
    if (coin(code)) p.network = method
    else if (side === 'src') p.payinMethod = method
    else p.rail = method
    if (!sourcesFor(user.country).includes(p.src)) p.src = 'USDC'
    if (kindOf(p) === 'unsupported') p.dst = p.src === 'USDC' ? user.country.fiat : 'USDC'
    if (p.src !== o.src) setAmount(startAmount(p.src))
    setO(normalize(p))
  }

  const phase = st?.phase ?? 'transfer'
  const phaseAt = PHASES.findIndex((p) => p.id === phase)
  // Going back is safe before anything is sent, and between calculator and review.
  const back = !busy && !finished && (i > 0 && i <= at('phone') ? i - 1 : st?.id === 'preview' ? calcAt : -1)
  const lastKey = log[log.length - 1]?.key
  const verified = !!(data['payer-verified'] || data['payer-address'])

  const screen = () => {
    if (finished) return <Finished c={c} onRestart={reset} />
    const s = st!
    const common = { st: s, c, busy, onNext: next }
    switch (s.ui) {
      case 'signup':
        return <SignUp {...common} user={user} onUser={(p) => setUser((u) => ({ ...u, ...p }))} />
      case 'email-otp':
        return <Otp {...common} title="Check your email" to={user.email} />
      case 'phone':
        return <Phone {...common} user={user} onUser={(p) => setUser((u) => ({ ...u, ...p }))} onCountry={setCountry} />
      case 'phone-otp':
        return <Otp {...common} title="Verify your phone" to={`${user.country.dial} ${user.phone}`} />
      case 'kyc-start':
        return <KycStart {...common} country={user.country} />
      case 'kyc-pan':
        return <KycPan {...common} user={user} />
      case 'kyc-doc':
        return <KycDoc {...common} country={user.country} doc={edits['kyc-doc']?.doc} onDoc={(doc) => setEdits((e) => ({ ...e, 'kyc-doc': { doc } }))} />
      case 'kyc-check':
        return <KycCheck {...common} doc={edits['kyc-doc']?.doc ?? docsFor(user.country)[0].name} />
      case 'kyc-selfie':
        return <KycSelfie {...common} />
      case 'kyc-done':
        return <KycDone {...common} country={user.country} />
      case 'calc':
        return <Calc {...common} o={o} amount={amount} onAmount={setAmount} sources={sourcesFor(user.country)} onCommit={commit} user={user} />
      case 'preview':
        return <Preview {...common} />
    }
    return (
      <FlowScreen st={s} c={c} busy={busy} edits={editsFor(s)} onEdit={(k, v) => setEdits((e) => ({ ...e, [s.id]: { ...editsFor(s), [k]: v } }))} onRun={() => next()} hash={hash} />
    )
  }

  return (
    <div className={`app demo${EMBED ? ' embed' : ''}`}>
      <main className="stage-area demo-stage" aria-label="Sample app">
        {/* Same phone as the KYC SDK demo in the docs (kycd-* in style.css). */}
        <div className="kphone">
          <div className="kdisplay">
            <div className="kstatus" aria-hidden="true">
              <span>9:41</span>
              <span className="kisland" />
              <StatusIcons />
            </div>
            <div className="kappbar">
              {back !== false && back >= 0 ? (
                <button className="kback" onClick={() => setI(back)} aria-label="Back">
                  <Icon name="chevron-left" size={20} />
                </button>
              ) : (
                <span />
              )}
              <span className="kbrand">
                <img className="klogo logo logo-light" src="/zapyd-light.svg" alt="Zapyd" />
                <img className="klogo logo logo-dark" src="/zapyd-dark.svg" alt="Zapyd" />
              </span>
              <span />
            </div>
            {st?.hosted && <p className="khosted">Secure verification by Zapyd</p>}
            <div className="kviewport" key={i}>
              {screen()}
            </div>
            <span className="khomebar" />
          </div>
        </div>
        <div className="kunder">
          <button className="kplay" onClick={reset} aria-label="Restart" title="Restart">
            <Icon name="rotate-ccw" size={16} />
          </button>
        </div>
      </main>

      <aside className="float panel panel-config" aria-label="Journey">
        <header className="panel-top">
          {EMBED ? (
            <span className="panel-heading">UI preview</span>
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

        <section className="cfg profile" aria-label="User">
          <span className="profile-avatar" aria-hidden="true">
            {user.name
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </span>
          <span className="profile-text">
            <span className="profile-name">{user.name || 'New user'}</span>
            <span className="profile-sub">
              <Flag c={user.country} size={14} />
              <span className="profile-clip">
                {user.country.name} · {fullKyc(user.country) ? 'Full KYC' : 'Payout-only'}
              </span>
            </span>
          </span>
          <span className={`profile-pill${verified ? ' ok' : ''}`}>{verified ? 'Verified' : 'Not verified'}</span>
        </section>

        {flow && choices(o).funding && i >= calcAt && !locked && (
          <section className="cfg" aria-label="Options">
            <div className="setting">
              <span className="setting-title">Funding</span>
              <div className="seg" role="radiogroup" aria-label="Funding">
                {(
                  [
                    ['jit', 'Per order', 'Send crypto for each payout'],
                    ['prefunded', 'Prefunded', 'Each payout debits a balance you top up'],
                  ] as const
                ).map(([v, l, t]) => (
                  <button key={v} role="radio" aria-checked={o.funding === v} title={t} onClick={() => setO(normalize({ ...o, funding: v }))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="cfg now" aria-labelledby="demo-now">
          {st && !finished ? (
            <>
              <p className="cfg-title" id="demo-now">
                <span className={`kind-chip kind-${st.hosted ? 'hosted' : st.kind}`}>
                  {st.kind === 'api' ? 'API call' : st.kind === 'event' ? 'Webhook' : st.hosted ? 'Hosted KYC' : st.kind === 'action' ? 'User action' : 'Your app'}
                </span>
                <span className="cfg-count">
                  {PHASES[phaseAt].title} · {i + 1}/{steps.length}
                </span>
              </p>
              <p className="now-title">{st.title}</p>
              <div className={`now-call kind-${st.hosted ? 'hosted' : st.kind}`}>
                <code className="caption-path">
                  {st.method ? (
                    <>
                      <b className={`verb verb-${st.method}`}>{st.method}</b> {st.path!.replace(/^\/\w+\/api\/v1/, '')}
                    </>
                  ) : st.kind === 'event' ? (
                    `${HOOKS[st.id].type} · ${HOOKS[st.id].event} → your server`
                  ) : st.hosted ? (
                    'app.zapyd.com/kyc · nothing to call'
                  ) : (
                    'No Zapyd call'
                  )}
                </code>
                {st.docs && (
                  <a className="icon-btn" href={docsUrl(st.docs)} target="_blank" rel="noreferrer" aria-label="Read the docs for this step" title="Read the docs for this step">
                    <Icon name="book" size={14} />
                  </a>
                )}
              </div>
              <p className="now-text">
                <Rich text={st.text} />
              </p>
              {steps[i + 1] && (
                <p className="now-next">
                  <span>Next</span>
                  {steps[i + 1].title}
                  <Icon name="arrow-right" size={12} />
                </p>
              )}
            </>
          ) : (
            <>
              <p className="cfg-title" id="demo-now">
                <span className="kind-chip kind-event">Complete</span>
                <span className="cfg-count">{steps.length}/{steps.length}</span>
              </p>
              <p className="now-title">{flow?.title}</p>
              <p className="now-text">{flow?.summary ?? 'Simulation of your app. Every screen maps to the calls on the right.'}</p>
            </>
          )}
        </section>
      </aside>

      <aside className="float panel panel-code" aria-label="API calls">
        <section className="code-panel">
          <header className="panel-head">
            <span className="panel-title">
              API calls
              <span className="flow-name">{log.filter((e) => e.kind === 'api').length} {log.filter((e) => e.kind === 'api').length === 1 ? 'call' : 'calls'}</span>
            </span>
            <span className="host">{HOST.replace('https://', '')}</span>
          </header>
          <div className="steps">
            <p className="auth-note">
              Simulated. Nothing is sent: responses are the documented examples, filled in with your request. Real requests carry <code>X-API-KEY</code>, <code>X-TIMESTAMP</code> and <code>X-SIGNATURE</code>.
            </p>
            {log.length ? (
              <ol className="logs">
                {log.map((e) => (
                  <LogEntry key={e.key} e={e} open={open[e.key] ?? e.key === lastKey} onToggle={() => setOpen((x) => ({ ...x, [e.key]: !(x[e.key] ?? e.key === lastKey) }))} />
                ))}
              </ol>
            ) : (
              <div className="empty console-empty">
                <Icon name="zap" size={18} />
                <p>Use the app. Each Zapyd call it makes shows up here, with its request and response.</p>
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- app screens

interface ScreenProps {
  st: JStep
  c: Ctx
  busy: boolean
  onNext: (alt?: boolean) => void
}

// A body that overflows gets a bottom fade, so cut-off content reads as scrollable.
function useScrolls<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [scrolls, setScrolls] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setScrolls(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, scrolls] as const
}

// The KYC demo's screen frame: header, scrolling body, button at the bottom.
function Frame(p: { title: ReactNode; sub?: ReactNode; children?: ReactNode; cta: string; ok?: boolean; busy?: boolean; onNext: () => void; extra?: ReactNode }) {
  const off = !p.ok || p.busy
  const [body, scrolls] = useScrolls<HTMLDivElement>()
  return (
    <form
      className="kscreen"
      onSubmit={(e) => {
        e.preventDefault()
        if (!off) p.onNext()
      }}
    >
      <div className={`kbody${scrolls ? ' scrolls' : ''}`} ref={body}>
        <div className="khead">
          <p className="ktitle">{p.title}</p>
          {p.sub && <p className="ksub">{p.sub}</p>}
        </div>
        {p.children}
      </div>
      <div className="kfoot">
        <button className={`kbtn ${off ? 'is-off' : 'is-on'}`} type="submit" disabled={off} aria-busy={p.busy}>
          {p.busy && <Spinner />}
          {p.cta}
        </button>
        {p.extra}
      </div>
    </form>
  )
}

// `valid` (default true) gates the check; a non-empty invalid value shows the
// error ring and turns the hint red once the field loses focus.
function Field(p: { label: string; value: string; onChange: (v: string) => void; type?: string; hint?: string; placeholder?: string; valid?: boolean; mono?: boolean; inputMode?: 'email' | 'numeric' | 'tel' | 'text'; autoComplete?: string; lead?: ReactNode }) {
  const filled = p.value.trim().length > 0
  const invalid = filled && p.valid === false
  return (
    <label className="kfield">
      <span className="klabel">{p.label}</span>
      <span className={`kinput${filled && !invalid ? ' filled' : ''}${invalid ? ' invalid' : ''}`}>
        {p.lead}
        <input
          className={p.mono ? 'kmono' : undefined}
          type={p.type ?? 'text'}
          inputMode={p.inputMode}
          autoComplete={p.autoComplete}
          placeholder={p.placeholder}
          value={p.value}
          aria-invalid={invalid || undefined}
          onChange={(e) => p.onChange(e.target.value)}
        />
        <Ok />
      </span>
      {p.hint && <span className={`khint${invalid ? ' invalid' : ''}`}>{p.hint}</span>}
    </label>
  )
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

function SignUp(p: ScreenProps & { user: User; onUser: (u: Partial<User>) => void }) {
  const [tos, setTos] = useState(true)
  const ok = p.user.name.trim().length > 1 && validEmail(p.user.email) && tos
  return (
    <Frame title="Create your account" sub="Start with your name and email. You'll verify both next." cta="Continue" ok={ok} onNext={() => p.onNext()}>
      <Field label="Full name" value={p.user.name} onChange={(name) => p.onUser({ name })} autoComplete="name" placeholder="First and last name" hint="As it appears on your ID." valid={p.user.name.trim().length > 1} />
      <Field label="Email address" type="email" inputMode="email" value={p.user.email} onChange={(email) => p.onUser({ email })} autoComplete="email" placeholder="you@example.com" hint="We'll send a code here." valid={validEmail(p.user.email)} />
      <label className="ktos">
        <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} />
        <span className="kbox" aria-hidden="true">
          <Icon name="check" size={12} />
        </span>
        <span>
          I agree to the <span className="klink-inline">Terms of Service</span> and <span className="klink-inline">Privacy Policy</span>.
        </span>
      </label>
    </Frame>
  )
}

// Six boxes over one real input, so paste, autofill and the keyboard just work.
function Otp(p: ScreenProps & { title: string; to: string }) {
  const [code, setCode] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  const api = p.st.kind === 'api'
  return (
    <Frame
      title={p.title}
      sub={
        <>
          We sent a 6-digit code to <b className="kstrong">{p.to}</b>.
        </>
      }
      cta={api ? 'Verify and continue' : 'Verify'}
      ok={code.length === 6}
      busy={p.busy}
      onNext={() => p.onNext()}
      extra={
        <button type="button" className="kghost" onClick={() => setCode('123456')}>
          Use sandbox code 123456
        </button>
      }
    >
      <label className="kotp">
        <span className="sr-only">Verification code</span>
        <input ref={ref} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        {Array.from({ length: 6 }, (_, n) => (
          <span key={n} className={`kotp-cell${n === code.length ? ' at' : ''}${code[n] ? ' on' : ''}`} aria-hidden="true">
            {code[n]}
          </span>
        ))}
      </label>
      <p className="khint">Didn't get it? Resend in 0:30</p>
    </Frame>
  )
}

function Phone(p: ScreenProps & { user: User; onUser: (u: Partial<User>) => void; onCountry: (c: Country) => void }) {
  const [sheet, setSheet] = useState(false)
  const c = p.user.country
  const m = market(c.fiat)!
  return (
    <>
      <Frame
        title="Add your phone"
        sub="Your phone's country is the country you're verified in."
        cta="Send code"
        ok={p.user.phone.replace(/\D/g, '').length >= 7}
        onNext={() => p.onNext()}
      >
        <div className="kfield">
          <span className="klabel">Phone number</span>
          <span className={`kinput${p.user.phone.trim() ? ' filled' : ''}`}>
            <button type="button" className="kcc" onClick={() => setSheet(true)} aria-label={`Country: ${c.name}, ${c.dial}. Change`}>
              <Flag c={c} size={18} />
              {c.dial}
              <Icon name="chevron-down" size={14} />
            </button>
            <input inputMode="tel" autoComplete="tel-national" value={p.user.phone} onChange={(e) => p.onUser({ phone: e.target.value })} aria-label="Phone number" />
            <Ok />
          </span>
        </div>
        <div className="kcountry">
          <Flag c={c} size={28} />
          <span className="kcountry-text">
            <span className="kcountry-name">KYC country: {c.name}</span>
            <span className="kcountry-sub">
              {fullKyc(c) ? `Full KYC. You can pay in ${m.fiat} and receive payouts.` : `Address only, no documents. You can receive ${m.fiat} payouts.`}
            </span>
          </span>
        </div>
      </Frame>
      {sheet && (
        <Sheet title="Country or region" onClose={() => setSheet(false)}>
          {(close) => (
            <SearchList
              placeholder="Search countries"
              items={COUNTRIES.map((x) => ({
                key: x.iso2,
                search: `${x.name} ${x.dial} ${x.fiat}`,
                icon: <Flag c={x} size={28} />,
                name: x.name,
                sub: fullKyc(x) ? `Full KYC · ${x.fiat} payins and payouts` : `Payout-only · ${x.fiat} payouts`,
                code: x.dial,
                on: x.iso2 === c.iso2,
                pick: () => {
                  p.onCountry(x)
                  close()
                },
              }))}
            />
          )}
        </Sheet>
      )}
    </>
  )
}

const DOCS_BY_COUNTRY: Record<string, { name: string; desc: string; icon: string }[]> = {
  INR: [
    { name: 'Aadhaar', desc: 'OTP through DigiLocker. Nothing to upload.', icon: 'id-card' },
    { name: 'Passport', desc: 'Upload the front and back pages.', icon: 'book' },
  ],
  USD: [
    { name: 'Passport', desc: 'The photo page.', icon: 'book' },
    { name: "Driver's license", desc: 'Front and back.', icon: 'id-card' },
    { name: 'State ID', desc: 'Front and back.', icon: 'id-card' },
  ],
}
const docsFor = (c: Country) => DOCS_BY_COUNTRY[c.fiat] ?? DOCS_BY_COUNTRY.USD

function KycStart(p: ScreenProps & { country: Country }) {
  const c = p.country
  const full = fullKyc(c)
  const needs = full
    ? [
        ...(c.fiat === 'INR' ? [{ icon: 'id-card', name: 'PAN', desc: 'Your Permanent Account Number' }] : []),
        { icon: 'book', name: 'Identity document', desc: docsFor(c).map((d) => d.name).join(' or ') },
        { icon: 'user-round', name: 'Selfie', desc: 'A quick liveness check' },
      ]
    : [{ icon: 'map-pin', name: 'Home address', desc: `In ${c.name}. No documents needed.` }]
  return (
    <form className="kscreen" onSubmit={(e) => e.preventDefault()}>
      <div className="kbody">
        <div className="khead">
          <p className="ktitle">Verify your identity</p>
          <p className="ksub">{full ? `${c.name} KYC takes about two minutes. Have these ready:` : `For payouts in ${c.name}, Zapyd only needs your address.`}</p>
        </div>
        <div className="kdocs">
          {needs.map((n) => (
            <div key={n.name} className="kdoc">
              <span className="kdoc-tile">
                <Icon name={n.icon} size={20} />
              </span>
              <span className="kdoc-text">
                <span className="kdoc-name">{n.name}</span>
                <span className="kdoc-desc">{n.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="kfoot">
        <button type="button" className={`kbtn ${p.busy ? 'is-off' : 'is-on'}`} disabled={p.busy} onClick={() => p.onNext(false)}>
          {p.busy && <Spinner />}
          {full ? 'Go through each step' : 'Enter my address'}
        </button>
        <button type="button" className="kbtn kbtn-2" disabled={p.busy} onClick={() => p.onNext(true)}>
          <Icon name="zap" size={16} />
          {full ? 'Auto-verify (sandbox)' : 'Auto-fill and verify (sandbox)'}
        </button>
      </div>
    </form>
  )
}

function KycPan(p: ScreenProps & { user: User }) {
  const [name, setName] = useState(p.user.name)
  const [dob, setDob] = useState('15-08-1992')
  const [pan, setPan] = useState('ABCDE1234F')
  const ok = name.trim().length > 1 && /^\d{2}-\d{2}-\d{4}$/.test(dob) && /^[A-Z]{5}\d{4}[A-Z]$/.test(pan)
  return (
    <Frame title="PAN verification" sub="Enter your Permanent Account Number to complete the tax identity check." cta="Verify PAN" ok={ok} onNext={() => p.onNext()}>
      <Field label="Name as on PAN" value={name} onChange={setName} valid={name.trim().length > 1} />
      <Field label="Date of birth" value={dob} onChange={setDob} hint="DD-MM-YYYY" placeholder="DD-MM-YYYY" inputMode="numeric" valid={/^\d{2}-\d{2}-\d{4}$/.test(dob)} />
      <Field label="PAN" value={pan} onChange={(v) => setPan(v.toUpperCase().slice(0, 10))} hint="5 letters, 4 digits, then 1 letter" placeholder="ABCDE1234F" mono valid={/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)} />
    </Frame>
  )
}

function KycDoc(p: ScreenProps & { country: Country; doc?: string; onDoc: (d: string) => void }) {
  const docs = docsFor(p.country)
  const doc = p.doc ?? docs[0].name
  return (
    <Frame title="Choose a document" sub="Select a document to verify your identity." cta="Continue" ok onNext={() => p.onNext()}>
      <div className="kdocs" role="radiogroup" aria-label="Document">
        {docs.map((d) => (
          <button type="button" key={d.name} role="radio" aria-checked={d.name === doc} className={`kdoc kdoc-pick${d.name === doc ? ' on' : ''}`} onClick={() => p.onDoc(d.name)}>
            <span className="kdoc-tile">
              <Icon name={d.icon} size={20} />
            </span>
            <span className="kdoc-text">
              <span className="kdoc-name">{d.name}</span>
              <span className="kdoc-desc">{d.desc}</span>
            </span>
            <span className="kradio" />
          </button>
        ))}
      </div>
    </Frame>
  )
}

// Checks tick off one by one, like the KYC demo's analysing screen.
function KycCheck(p: ScreenProps & { doc: string }) {
  const checks = p.doc === 'Aadhaar' ? ['Connecting to DigiLocker', 'Fetching Aadhaar details', 'Matching name and date of birth'] : ['Reading the document', 'Checking for tampering', 'Matching your details']
  const [done, setDone] = useState(0)
  useEffect(() => {
    if (done >= checks.length) return
    const t = setTimeout(() => setDone((d) => d + 1), 750)
    return () => clearTimeout(t)
  }, [done, checks.length])
  const all = done >= checks.length
  return (
    <form
      className="kscreen"
      onSubmit={(e) => {
        e.preventDefault()
        if (all) p.onNext()
      }}
    >
      <div className={`kcenter${all ? ' ok' : ''}`} role="status">
        <span className="korb">
          <span className="korb-wait">
            <Icon name="id-card" size={26} />
            <Ring />
          </span>
          <span className="korb-ok">
            <Icon name="check" size={30} />
          </span>
        </span>
        <p className="ktitle">{all ? `${p.doc} verified` : `Verifying your ${p.doc}`}</p>
        <p className="ksub">{all ? 'One last step: a quick selfie.' : 'This takes just a moment…'}</p>
        <div className="kchecks">
          {checks.map((x, n) => (
            <Check key={x} done={n < done}>
              {x}
            </Check>
          ))}
        </div>
      </div>
      <div className="kfoot">
        <button className={`kbtn ${all ? 'is-on' : 'is-off'}`} type="submit" disabled={!all}>
          Continue
        </button>
      </div>
    </form>
  )
}

// Camera on top, edge to edge; the guide ring fills as the scan runs, then
// turns green with a check before the screen moves on.
function KycSelfie(p: ScreenProps) {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle')
  useEffect(() => {
    if (phase === 'idle') return
    const t = setTimeout(() => (phase === 'scanning' ? setPhase('done') : p.onNext()), phase === 'scanning' ? 1800 : 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  const text = { idle: 'Position your face in the frame', scanning: 'Hold still', done: 'Looks good' }[phase]
  return (
    <form
      className="kscreen"
      onSubmit={(e) => {
        e.preventDefault()
        if (phase === 'idle') setPhase('scanning')
      }}
    >
      <div className="kbody kbody-cam">
        <div className={`kcam ${phase}`} role="img" aria-label="Camera preview">
          <div className="kcam-stage">
            <svg className="kcam-ring" width="156" height="196" viewBox="0 0 156 196" fill="none" aria-hidden="true">
              <ellipse cx="78" cy="98" rx="74" ry="94" className="kring-track" />
              <path d="M78 4 A74 94 0 1 1 77.99 4" className="kring-fill" pathLength={100} />
            </svg>
            <div className="koval">
              <svg className="kface" width="120" height="150" viewBox="0 0 120 150" fill="currentColor" aria-hidden="true">
                <ellipse cx="60" cy="58" rx="28" ry="34" />
                <path d="M6 150c4-34 26-52 54-52s50 18 54 52z" />
              </svg>
            </div>
            <span className="kcam-ok" aria-hidden="true">
              <Icon name="check" size={18} />
            </span>
          </div>
          <span className="kcam-pill">
            <span className="krec" />
            {text}
          </span>
        </div>
        <div className="khead">
          <p className="ktitle">Take a selfie</p>
          <p className="ksub">Good light, no glasses or hat, so it matches your document.</p>
        </div>
      </div>
      <div className="kfoot">
        <button className={`kbtn ${phase === 'idle' ? 'is-on' : 'is-off'}`} type="submit" disabled={phase !== 'idle'} aria-busy={phase === 'scanning'}>
          {phase === 'scanning' && <Spinner />}
          {phase === 'idle' ? 'Take selfie' : phase === 'scanning' ? 'Scanning…' : 'Verified'}
        </button>
      </div>
    </form>
  )
}

function KycDone(p: ScreenProps & { country: Country }) {
  return (
    <form
      className="kscreen"
      onSubmit={(e) => {
        e.preventDefault()
        p.onNext()
      }}
    >
      <div className="kcenter done">
        <span className="kbadge">
          <Icon name="check" size={30} />
        </span>
        <p className="ktitle">You're verified</p>
        <p className="ksub">You can now receive {p.country.fiat} payouts in {p.country.name}.</p>
        <span className="kpill">Verified</span>
      </div>
      <div className="kfoot">
        <button className="kbtn is-on" type="submit">
          Continue
        </button>
      </div>
    </form>
  )
}

const Ring = () => (
  <svg className="korb-ring" width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
    <circle cx="42" cy="42" r="40" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" />
    <path d="M42 2a40 40 0 0 1 40 40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

// ---------------------------------------------------------------- calculator

const methodText = (o: Opts, side: Side) => {
  const code = side === 'src' ? o.src : o.dst
  if (coin(code)) return `on ${NETWORKS[o.network] ?? o.network}`
  return `via ${railName(side === 'src' ? o.payinMethod : o.rail)}`
}
const nameOf = (code: string) => market(code)?.currency ?? coin(code)?.name ?? code
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Calc(p: ScreenProps & { o: Opts; amount: string; onAmount: (a: string) => void; sources: string[]; onCommit: (side: Side, code: string, method: string) => void; user: User }) {
  const { o } = p
  const [side, setSide] = useState<Side | null>(null)
  const kind = kindOf(o)
  const f = build(o)
  const bad = 'unsupported' in f ? f.unsupported : ''
  const value = Number(p.amount) || 0
  const out = convert(value, o.src, o.dst)
  const self = o.dst === p.user.country.fiat || coin(o.dst)
  const row = (side: Side, label: string, field: ReactNode) => {
    const code = side === 'src' ? o.src : o.dst
    return (
      <div className="kcalc-row">
        <span className="klabel">{label}</span>
        <div className="kamount kinput">
          {field}
          <button type="button" className="kcode kcode-btn" onClick={() => setSide(side)} aria-label={`${label}: ${nameOf(code)}. Change`}>
            <Icon name={market(code) ? `flag:${code}` : `coin:${code}`} size={18} />
            {code}
            <Icon name="chevron-down" size={14} />
          </button>
        </div>
        <span className="khint">
          {nameOf(code)} {methodText(o, side)}
        </span>
      </div>
    )
  }
  const coinSide = coin(o.src) ? o.src : coin(o.dst) ? o.dst : null
  const fiat = coinSide === o.src ? o.dst : o.src
  const rateText = coinSide ? `1 ${coinSide} = ${fmt(RATE[fiat] ?? 1)} ${fiat}` : `1 ${o.src} = ${convert(1, o.src, o.dst).toFixed(4)} ${o.dst}`
  return (
    <>
      <Frame title="Send money" sub="Choose what you send and what arrives." cta="Review" ok={!bad && value > 0} onNext={() => p.onNext()}>
        <div className="kcalc">
          {row('src', 'You send', <input inputMode="decimal" value={p.amount} onChange={(e) => p.onAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Amount you send" />)}
          <div className={`kcalc-mid kind-${kind}`}>
            <span className="kind-dot" />
            <span>{bad ? 'Not available' : `${KIND_SHORT[kind]} · ${rateText}`}</span>
          </div>
          {row('dst', self ? 'You get' : 'They receive', <output className="kcalc-out">{bad ? '—' : fmt(out)}</output>)}
        </div>
        {bad ? (
          <p className="kwarn">{bad}</p>
        ) : (
          <Rows
            rows={[
              ['Fees', 'None in sandbox'],
              ...(kind === 'remittance' ? ([['Converted through', `${o.bridge} on ${NETWORKS[o.network] ?? o.network}`]] as [string, string][]) : []),
              ...(market(o.dst) && o.funding === 'prefunded' ? ([['Paid from', 'Your prefunded balance']] as [string, string][]) : []),
            ]}
          />
        )}
      </Frame>
      {side && (
        <Sheet title={side === 'src' ? 'Send from' : 'Send to'} onClose={() => setSide(null)}>
          {(close) => (
            <>
              {side === 'src' && !p.sources.includes(p.user.country.fiat) && (
                <p className="ksheet-note">{market(p.user.country.fiat)!.currency} payins aren't available, so you send stablecoins. You can still receive {p.user.country.fiat}.</p>
              )}
              <CurrencyPick side={side} o={o} codes={side === 'src' ? p.sources : DESTINATIONS} onCommit={(code, method) => (p.onCommit(side, code, method), close())} />
            </>
          )}
        </Sheet>
      )}
    </>
  )
}

// The Flow Builder's picker, as a sheet: pick a currency or asset, then its
// network, payin method or payout rail. Both lock together.
function CurrencyPick(p: { side: Side; o: Opts; codes: string[]; onCommit: (code: string, method: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const current = p.side === 'src' ? p.o.src : p.o.dst
  const currentMethod = coin(current) ? p.o.network : p.side === 'src' ? p.o.payinMethod : p.o.rail
  if (picked) {
    const step = stepFor(p.o, p.side, picked)
    return (
      <div className="ksheet-step">
        <button type="button" className="ksheet-back" onClick={() => setPicked(null)}>
          <Icon name="chevron-left" size={16} />
          <Icon name={market(picked) ? `flag:${picked}` : `coin:${picked}`} size={20} />
          <span>
            <span className="ksheet-back-title">{step.title}</span>
            <span className="ksheet-back-sub">
              {nameOf(picked)} · {picked}
            </span>
          </span>
        </button>
        <ul className="klist" role="listbox" aria-label={step.title}>
          {step.items.map((it) => (
            <li key={it.value}>
              <button
                type="button"
                role="option"
                aria-selected={picked === current && it.value === currentMethod}
                disabled={!!it.disabled}
                className="kitem"
                onClick={() => p.onCommit(picked, it.value)}
              >
                {step.key === 'network' ? (
                  <Icon name={`net:${it.value}`} size={28} />
                ) : (
                  <span className="kitem-glyph">
                    <Icon name={step.key === 'payinMethod' ? 'arrow-down' : 'landmark'} size={16} />
                  </span>
                )}
                <span className="kitem-text">
                  <span className="kitem-name">{it.label}</span>
                  <span className="kitem-sub">{it.disabled ?? it.sub}</span>
                </span>
                {picked === current && it.value === currentMethod && <Icon name="check" size={16} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const groups = [
    { title: 'Stablecoins', codes: p.codes.filter((x) => !market(x)) },
    { title: p.side === 'src' ? 'Pay in with fiat' : 'Pay out to fiat', codes: p.codes.filter((x) => market(x)) },
  ]
  return (
    <SearchList
      placeholder="Search currencies or assets"
      groups={groups.map((g) => ({
        title: g.title,
        items: g.codes.map((code) => ({
          key: code,
          search: `${code} ${nameOf(code)} ${market(code)?.country ?? ''}`,
          icon: <Icon name={market(code) ? `flag:${code}` : `coin:${code}`} size={28} />,
          name: nameOf(code),
          sub: subtitle(code, p.side),
          code,
          on: code === current,
          next: true,
          pick: () => setPicked(code),
        })),
      }))}
    />
  )
}

interface ListItem {
  key: string
  search: string
  icon: ReactNode
  name: string
  sub: string
  code: string
  on?: boolean
  next?: boolean
  pick: () => void
}
function SearchList(p: { placeholder: string; items?: ListItem[]; groups?: { title: string; items: ListItem[] }[] }) {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const groups = (p.groups ?? [{ title: '', items: p.items! }]).map((g) => ({ ...g, items: g.items.filter((x) => x.search.toLowerCase().includes(needle)) })).filter((g) => g.items.length)
  return (
    <>
      <label className="ksearch">
        <Icon name="search" size={16} />
        <input placeholder={p.placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label={p.placeholder} />
      </label>
      <div className="klist-scroll">
        {groups.map((g) => (
          <div key={g.title} role="group" aria-label={g.title || undefined}>
            {g.title && <p className="klist-group">{g.title}</p>}
            <ul className="klist">
              {g.items.map((x) => (
                <li key={x.key}>
                  <button type="button" className={`kitem${x.on ? ' on' : ''}`} onClick={x.pick}>
                    {x.icon}
                    <span className="kitem-text">
                      <span className="kitem-name">{x.name}</span>
                      <span className="kitem-sub">{x.sub}</span>
                    </span>
                    <span className="kitem-code">{x.code}</span>
                    {x.next ? <Icon name="chevron-right" size={14} /> : x.on ? <Icon name="check" size={16} /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!groups.length && <p className="klist-empty">Nothing matches “{q}”.</p>}
      </div>
    </>
  )
}

// A bottom sheet inside the phone. Slides up; leaves softer than it came.
function Sheet(p: { title: string; onClose: () => void; children: (close: () => void) => ReactNode }) {
  const [leaving, setLeaving] = useState(false)
  const close = () => setLeaving(true)
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && setLeaving(true)
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  }, [])
  return (
    <div className={`ksheet-wrap${leaving ? ' leaving' : ''}`} onAnimationEnd={(e) => leaving && e.target === e.currentTarget && p.onClose()}>
      <button type="button" className="ksheet-scrim" aria-label="Close" onClick={close} />
      <div className="ksheet" role="dialog" aria-modal="true" aria-label={p.title}>
        <span className="ksheet-grab" aria-hidden="true" />
        <div className="ksheet-head">
          <p className="ksheet-title">{p.title}</p>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        {p.children(close)}
      </div>
    </div>
  )
}

function Preview(p: ScreenProps) {
  const { o, amount } = p.c
  const kind = kindOf(o)
  const out = convert(Number(amount), o.src, o.dst)
  const net = NETWORKS[o.network] ?? o.network
  const coinSide = coin(o.src) ? o.src : coin(o.dst) ? o.dst : null
  const fiat = coinSide === o.src ? o.dst : o.src
  const legs: { icon: string; title: string; sub: string }[] = [
    { icon: market(o.src) ? `flag:${o.src}` : `coin:${o.src}`, title: money(amount, o.src), sub: market(o.src) ? `Paid ${methodText(o, 'src')}` : o.funding === 'prefunded' && market(o.dst) ? 'From your app\'s prefunded balance' : `Sent ${methodText(o, 'src')}` },
    ...(kind === 'remittance' ? [{ icon: `coin:${o.bridge}`, title: `${o.bridge} on ${net}`, sub: 'Converted in between' }] : []),
    { icon: market(o.dst) ? `flag:${o.dst}` : `coin:${o.dst}`, title: money(out.toFixed(2), o.dst), sub: market(o.dst) ? `Paid out ${methodText(o, 'dst')}` : `Delivered ${methodText(o, 'dst')}` },
  ]
  return (
    <Frame title="Review your transfer" sub={KIND_TEXT[kind]} cta="Confirm and continue" ok onNext={() => p.onNext()}>
      <ol className="kroute">
        {legs.map((l) => (
          <li key={l.title}>
            <Icon name={l.icon} size={28} />
            <span className="kroute-text">
              <span className="kroute-title">{l.title}</span>
              <span className="kroute-sub">{l.sub}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="kfield">
        <span className="klabel">Order details</span>
        <Rows
          rows={[
            ['Rate', coinSide ? `1 ${coinSide} = ${fmt(RATE[fiat] ?? 1)} ${fiat}` : `1 ${o.src} = ${fmt(convert(1, o.src, o.dst))} ${o.dst}`],
            ['Fees', money(0, o.src)],
            ['Total to pay', money(amount, o.src)],
            ...(market(o.src) ? ([['Pay via', railName(o.payinMethod)]] as [string, string][]) : []),
            ['Network', net],
            ...(market(o.dst) ? ([['Paid out via', railName(o.rail)]] as [string, string][]) : []),
            ...(market(o.dst) && o.funding === 'prefunded' ? ([['Funded from', 'Prefunded balance']] as [string, string][]) : []),
            ['Arrives', market(o.dst) ? 'Same day, once the payout clears' : 'When the payin settles'],
          ]}
        />
      </div>
    </Frame>
  )
}

// ---------------------------------------------------------------- flow screens

function FlowScreen(p: { st: Step; c: Ctx; busy: boolean; edits: Record<string, string>; onEdit: (k: string, v: string) => void; onRun: () => void; hash: string }) {
  const { st, c } = p
  const t = copy(st, c)
  const body = request(st, p.edits, p.hash)
  const inputs = body ? fields(body) : []
  const amount = inputs.find(([k]) => k === 'sending_amount' || k === 'receiving_amount')
  const rest = inputs.filter((f) => f !== amount)
  const landed = st.kind === 'event' && !!c.data[st.id]
  const waiting = st.kind === 'event' && !landed
  const net = NETWORKS[c.o.network] ?? c.o.network
  const payinQ = c.data['payin-quote']
  const payoutQ = c.data['payout-quote']
  const amountCode = amount?.[0] === 'receiving_amount' ? c.o.dst : st.id === 'payin-quote' ? c.o.src : c.asset
  // The calculator fixed both ends; a quote only locks the rate for them.
  const quote = (() => {
    if (!amount || (st.id !== 'payin-quote' && st.id !== 'payout-quote')) return null
    const v = Number(amount[1]) || 0
    if (st.id === 'payin-quote') return { from: c.o.src, to: c.asset, send: v, get: v / (RATE[c.o.src] ?? 1), fiat: c.o.src }
    const rate = RATE[c.o.dst] ?? 1
    return amount[0] === 'receiving_amount'
      ? { from: c.asset, to: c.o.dst, send: v / rate, get: v, fiat: c.o.dst }
      : { from: c.asset, to: c.o.dst, send: v, get: v * rate, fiat: c.o.dst }
  })()
  const off = p.busy || waiting
  const [bodyRef, scrolls] = useScrolls<HTMLDivElement>()

  return (
    <form
      className="kscreen"
      onSubmit={(e) => {
        e.preventDefault()
        p.onRun()
      }}
    >
      {st.kind === 'event' ? (
        <div className={`kcenter${landed ? ' ok' : ''}`} role="status">
          {/* Waiting orb and success badge stay mounted and cross-fade. */}
          <span className="korb">
            <span className="korb-wait">
              <Icon name="bell" size={26} />
              <svg className="korb-ring" width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
                <circle cx="42" cy="42" r="40" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" />
                <path d="M42 2a40 40 0 0 1 40 40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="korb-ok">
              <Icon name="check" size={30} />
            </span>
          </span>
          <p className="ktitle">{landed ? t.done : t.title}</p>
          <p className="ksub">{landed ? `Zapyd sent the ${HOOKS[st.id].type} webhook to your server.` : 'Zapyd is processing. Your server hears back by webhook.'}</p>
          <div className="kchecks">
            <Check done>Request accepted</Check>
            <Check done={landed}>
              {HOOKS[st.id].type} webhook · {HOOKS[st.id].event}
            </Check>
          </div>
        </div>
      ) : (
        <div className={`kbody${scrolls ? ' scrolls' : ''}`} ref={bodyRef}>
          <div className="khead">
            <p className="ktitle">{t.title}</p>
            {t.sub && <p className="ksub">{t.sub}</p>}
          </div>

          {amount && quote && (
            <Rows
              rows={[
                [st.id === 'payin-quote' ? 'You send' : 'Sending', money(quote.send, quote.from)],
                [c.o.dst === c.user.country.fiat || coin(c.o.dst) ? 'You get' : 'They receive', money(quote.get, quote.to)],
                ['Rate', `1 ${c.asset} = ${fmt(RATE[quote.fiat] ?? 1)} ${quote.fiat}`],
                ...(st.id === 'payout-quote' && c.o.funding === 'prefunded' ? ([['Paid from', 'Your prefunded balance']] as [string, string][]) : []),
              ]}
            />
          )}
          {amount && !quote && (
            <div className="kfield">
              <span className="klabel">{label(amount[0])}</span>
              <label className="kinput kamount">
                <input
                  inputMode="decimal"
                  value={amount[1]}
                  aria-label={label(amount[0])}
                  onChange={(e) => p.onEdit(amount[0], e.target.value.replace(/[^\d.]/g, ''))}
                  required
                />
                <span className="kcode">
                  <Icon name={market(amountCode) ? `flag:${amountCode}` : `coin:${amountCode}`} size={18} />
                  {amountCode}
                </span>
              </label>
              <span className="khint">
                {c.asset} on {net}
                {st.id === 'payout-quote' && c.o.funding === 'prefunded' ? ', from your prefunded balance' : ''}
              </span>
            </div>
          )}

          {rest.map(([k, v]) => (
            <label key={k} className="kfield">
              <span className="klabel">{label(k)}</span>
              <span className={`kinput${v.trim() ? ' filled' : ''}`}>
                <input value={v} onChange={(e) => p.onEdit(k, e.target.value)} required={k === 'transaction_reference_id' || undefined} />
                <Ok />
              </span>
            </label>
          ))}

          {st.id === 'payin-pay' && payinQ && (
            <>
              <QuoteSummary q={payinQ} payin />
              {payinQ.deposit_instructions && (
                <div className="kfield">
                  <span className="klabel">{c.o.payinMethod === 'UPI' ? 'Pay with any UPI app' : 'Transfer to'}</span>
                  <Rows rows={Object.entries(payinQ.deposit_instructions as Json).filter(([k]) => k !== 'ios_checkout_link').map(([k, v]) => [label(k), String(v)])} />
                </div>
              )}
            </>
          )}
          {st.id === 'payin-initiate' && <QuoteSummary q={payinQ} payin />}
          {(st.id === 'payout-balance' || st.id === 'payout-initiate') && <QuoteSummary q={payoutQ} payin={false} />}
          {st.id === 'payout-initiate' && c.data['payout-balance'] && (
            <Rows rows={[['Available balance', money(c.data['payout-balance'].available_balance[c.asset], c.asset)]]} />
          )}
          {st.id === 'payout-send' && payoutQ && (
            <>
              <QuoteSummary q={payoutQ} payin={false} />
              <div className="kfield">
                <span className="klabel">To this {net} address</span>
                <code className="kaddress">{payoutQ.wallet_address}</code>
              </div>
            </>
          )}
        </div>
      )}

      <div className="kfoot">
        <button className={`kbtn ${off ? 'is-off' : 'is-on'}`} type="submit" disabled={off} aria-busy={p.busy}>
          {p.busy && <Spinner />}
          {waiting ? 'Waiting for Zapyd…' : t.cta}
        </button>
      </div>
    </form>
  )
}

function Finished({ c, onRestart }: { c: Ctx; onRestart: () => void }) {
  const last = c.flow.steps[c.flow.steps.length - 1]
  const hash = new URLSearchParams(c.o as unknown as Record<string, string>).toString()
  return (
    <div className="kscreen">
      <div className="kcenter done">
        <span className="kbadge">
          <Icon name="check" size={30} />
        </span>
        <p className="ktitle">{copy(last, c).done}</p>
        <p className="ksub">{c.flow.summary}</p>
        <span className="kpill">Complete</span>
      </div>
      <div className="kfoot">
        <button className="kbtn is-on" onClick={onRestart}>
          Run again
        </button>
        <a className="klink" href={docsUrl(`/flow-builder#${hash}`)} target="_top">
          See every call in the Flow builder <Icon name="arrow-right" size={12} />
        </a>
      </div>
    </div>
  )
}
