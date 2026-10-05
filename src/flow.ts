// Turns a source, a destination and a few options into the chain of Zapyd API
// calls, as canvas groups (what the user sees chained) and numbered code steps.
import raw from './data/markets.json'

export interface Rail {
  method: string
  payment_method?: string
  identifiers: string[] | Record<string, string>
  beneficiary?: string[]
}
export interface Market {
  fiat: string
  currency: string
  country: string
  flag: string
  alpha3: string
  guide: string
  address: string[]
  payin: null | {
    methods: string[]
    reference: 'required' | 'optional'
    kyc: Kyc[]
    customer: Record<string, string>
  }
  onboarding: 'standard' | 'payout-only'
  sample?: {
    name: string
    address: Record<string, string>
    beneficiary: Record<string, string>
    ids: Record<string, string>
  }
  rails: Rail[]
}
export interface Coin {
  code: string
  name: string
  networks: string[]
}

export const MARKETS = raw.markets as unknown as Market[]
export const COINS = raw.stablecoins as Coin[]
export const market = (fiat: string) => MARKETS.find((m) => m.fiat === fiat)
export const coin = (code: string) => COINS.find((c) => c.code === code)

export type Kyc = 'sharing' | 'sdk'
export interface Opts {
  src: string
  dst: string
  network: string
  payinMethod: string
  rail: string
  funding: 'jit' | 'prefunded'
  purpose: 'payout' | 'remittance'
  kyc: Kyc
  bridge: string
}

export const DEFAULTS: Opts = {
  src: 'USDC',
  dst: 'MXN',
  network: 'polygon',
  payinMethod: '',
  rail: '',
  funding: 'jit',
  purpose: 'payout',
  kyc: 'sdk',
  bridge: 'USDC',
}

export const NETWORKS: Record<string, string> = {
  tron: 'Tron',
  ethereum: 'Ethereum',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  solana: 'Solana',
  bsc: 'BNB Chain',
}

const SYMBOL: Record<string, string> = { INR: '₹', USD: '$' }
const PAYIN_AMOUNT: Record<string, string> = { INR: '10000', USD: '1000' }

// Identifier values the market sample doesn't cover (second rails).
const EXTRA_IDS: Record<string, Record<string, string>> = {
  COP: { phone_number: '3001234567' },
  EUR: { bank_name: 'Commerzbank' },
  USD: { swift_code: 'CHASUS33' },
}

export const isFiat = (code: string) => !!market(code)

// What each side can offer, and which options apply, for the current choice.
export interface Choices {
  networks: string[]
  payinMethods: string[]
  rails: { method: string; disabled?: string }[]
  kyc: Kyc[]
  funding: boolean
  remittance: '' | 'rda' | 'purpose'
  // Fiat to fiat is always a remittance, so the purpose isn't a choice there.
  purposeLocked: boolean
  remittanceDisabled?: string
  // Fiat to INR: a standard payout or the RDA remittance API.
  indiaApi: boolean
  bridge: boolean
}

export function choices(o: Opts): Choices {
  const s = market(o.src)
  const d = market(o.dst)
  const asset = s ? (d ? o.bridge : o.dst) : o.src
  const rda = d?.fiat === 'INR'
  const kyc: Kyc[] = []
  if (s?.payin) kyc.push(...s.payin.kyc)
  else if (d?.onboarding === 'standard' && o.purpose === 'payout') kyc.push('sharing', 'sdk')
  return {
    networks: coin(asset)?.networks ?? [],
    payinMethods: s?.payin?.methods ?? [],
    rails: (d?.rails ?? []).map((r) => ({
      method: r.method,
      disabled: rda && o.purpose === 'remittance' && r.method === 'UPI' ? 'Not available for cross-border transfers' : undefined,
    })),
    kyc: [...new Set(kyc)],
    funding: !!d,
    remittance: d ? (rda ? 'rda' : 'purpose') : '',
    purposeLocked: !!(s && d),
    remittanceDisabled: rda && s?.fiat === 'INR' ? 'The remitter must live outside India' : undefined,
    indiaApi: !!s && rda && s.fiat !== 'INR',
    bridge: !!(s && d),
  }
}

// The two payout APIs for fiat to INR.
export const INDIA_API: { value: Opts['purpose']; label: string; sub: string }[] = [
  { value: 'payout', label: 'Standard', sub: 'Full KYC beneficiary, IMPS or UPI' },
  { value: 'remittance', label: 'RDA', sub: 'Light beneficiary KYC and a remitter abroad' },
]

// Snap options that don't fit the current source and destination.
export function normalize(o: Opts): Opts {
  const n = { ...o }
  const c = choices(n)
  if (!c.payinMethods.includes(n.payinMethod)) n.payinMethod = c.payinMethods[0] ?? ''
  // The pair decides the purpose: fiat to fiat is cross-border, anything else a
  // payout. Fiat to INR keeps the chosen API (standard payout or RDA).
  n.purpose = c.indiaApi ? n.purpose : c.purposeLocked && !c.remittanceDisabled ? 'remittance' : 'payout'
  const c2 = choices(n)
  if (!c2.networks.includes(n.network)) n.network = c2.networks[0] ?? ''
  const ok = c2.rails.filter((r) => !r.disabled).map((r) => r.method)
  if (!ok.includes(n.rail)) n.rail = ok[0] ?? ''
  if (c2.kyc.length && !c2.kyc.includes(n.kyc)) n.kyc = c2.kyc[c2.kyc.length - 1]
  if (!coin(n.bridge) || !OFFERED_COINS.includes(n.bridge)) n.bridge = 'USDC'
  return n
}

// ---------------------------------------------------------------- pickers

// Sources: stablecoins and the fiats that run payins. Destinations: stablecoins
// and every payout fiat. The pair decides the flow.
// USDT is not offered: USDC is the only stablecoin on either side and the bridge.
export const OFFERED_COINS = ['USDC']
export const SOURCES = [...OFFERED_COINS, ...MARKETS.filter((m) => m.payin).map((m) => m.fiat)]
export const DESTINATIONS = [...OFFERED_COINS, ...MARKETS.map((m) => m.fiat)]

export type FlowKind = 'onramp' | 'offramp' | 'remittance' | 'unsupported'
export function kindOf(o: Pick<Opts, 'src' | 'dst'>): FlowKind {
  const s = isFiat(o.src)
  const d = isFiat(o.dst)
  if (s && d) return o.src === o.dst ? 'unsupported' : 'remittance'
  if (s) return 'onramp'
  if (d) return 'offramp'
  return 'unsupported'
}

const RAIL_NAMES: Record<string, string> = {
  ACCOUNT_DETAILS: 'Bank account',
  'BANK-TRANSFER': 'Bank transfer',
  ACH_PUSH: 'ACH',
  ACH_PULL: 'ACH',
  DOMESTIC_WIRE: 'Domestic wire',
  FEDWIRE: 'Fedwire',
  WIRE: 'Wire',
  PESONET: 'PESONet',
  INSTAPAY: 'InstaPay',
  NEQUI: 'Nequi',
}
export const railName = (r: string) => RAIL_NAMES[r] ?? r

// What a currency moves over, for the picker: payin methods for a source,
// payout rails for a destination, networks for a stablecoin.
export function subtitle(code: string, side: 'src' | 'dst') {
  const k = coin(code)
  if (k) return k.networks.map((n) => NETWORKS[n] ?? n).join(', ')
  const m = market(code)!
  const list = side === 'src' ? m.payin!.methods : m.rails.map((r) => r.method)
  return [...new Set(list.map(railName))].join(', ')
}

export type Side = 'src' | 'dst'

// The pair after picking `code` on one side. Picking a stablecoin on both
// sides, or the same currency twice, flips the other side instead of
// dead-ending.
export function pairFor(o: Opts, side: 'src' | 'dst', code: string): Pick<Opts, 'src' | 'dst'> {
  if (side === 'src') {
    if (code === o.dst) return { src: code, dst: o.src }
    if (coin(code) && coin(o.dst)) return { src: code, dst: coin(o.src) ? 'MXN' : o.src }
    return { src: code, dst: o.dst }
  }
  if (code === o.src) return { src: SOURCES.includes(o.dst) ? o.dst : 'USDC', dst: code }
  if (coin(code) && coin(o.src)) return { src: market(o.dst)?.payin ? o.dst : 'USD', dst: code }
  return { src: o.src, dst: code }
}

const STANDARD: Record<string, string> = {
  tron: 'TRC-20',
  ethereum: 'ERC-20',
  polygon: 'Polygon PoS',
  arbitrum: 'Arbitrum One',
  solana: 'SPL token',
  bsc: 'BEP-20',
}
const PAYIN_NOTE: Record<string, string> = {
  IMPS: 'Instant bank transfer, sent with a UTR',
  UPI: 'Any UPI app, or scan a QR code',
  ACH_PULL: 'Debit a bank account the customer linked',
  WIRE: 'Domestic wire to deposit instructions',
  RTP: 'Real-time payment to deposit instructions',
}
const FIELD: Record<string, string> = {
  mx_clabe: 'CLABE',
  br_cpf: 'CPF',
  account_number: 'account number',
  ifsc: 'IFSC',
  vpa: 'UPI ID',
  swift_code: 'SWIFT',
  routing_number: 'routing number',
  sort_code: 'sort code',
  bank_code: 'bank code',
  bank_name: 'bank name',
  account_holder_name: 'holder name',
  account_type: 'account type',
  phone_number: 'phone number',
}

export interface StepItem {
  value: string
  label: string
  sub: string
  disabled?: string
}

// Second picker step: what to lock together with the chosen code.
export function stepFor(o: Opts, side: Side, code: string): { title: string; key: 'network' | 'payinMethod' | 'rail'; items: StepItem[] } {
  const k = coin(code)
  if (k)
    return {
      title: 'Choose a network',
      key: 'network',
      items: k.networks.map((n) => ({ value: n, label: NETWORKS[n] ?? n, sub: `${k.code} as ${STANDARD[n] ?? n}` })),
    }
  const m = market(code)!
  if (side === 'src')
    return {
      title: 'Choose a payin method',
      key: 'payinMethod',
      items: m.payin!.methods.map((x) => ({ value: x, label: railName(x), sub: PAYIN_NOTE[x] ?? x })),
    }
  const c = choices(normalize({ ...o, ...pairFor(o, 'dst', code) }))
  return {
    title: 'Choose a payout rail',
    key: 'rail',
    items: m.rails.map((r) => {
      const ids = Array.isArray(r.identifiers) ? r.identifiers : Object.keys(r.identifiers)
      return {
        value: r.method,
        label: railName(r.method) === r.method ? r.method : `${railName(r.method)}`,
        sub: `Needs ${ids.map((f) => FIELD[f] ?? f.replace(/_/g, ' ')).join(', ')}`,
        disabled: c.rails.find((x) => x.method === r.method)?.disabled,
      }
    }),
  }
}

// ---------------------------------------------------------------- flow model

export type Tone = 'gray' | 'blue' | 'orange' | 'green'
export type RowKind = 'api' | 'action' | 'event' | 'endpoint' | 'info'
export interface Row {
  id: string
  icon: string
  label: string
  sub?: string
  kind: RowKind
  step?: number
}
export interface Group {
  id: string
  col: number
  title: string
  tag?: { label: string; tone: Tone; warn?: boolean }
  dashed?: boolean
  rows: Row[]
}
export interface Edge {
  from: string // row id
  to: string // group id
  tone: Tone
}
export interface Step {
  n: number
  id: string
  kind: RowKind
  title: string
  text: string
  method?: 'GET' | 'POST'
  path?: string
  body?: unknown
  docs?: string
  // The `data.id` the response returns, which later steps send back.
  returns?: string
}
export interface Flow {
  title: string
  summary: string
  groups: Group[]
  edges: Edge[]
  steps: Step[]
}

export const HOST = 'https://sandbox.zapyd.com'
// Mintlify host until docs.zapyd.com is live.
const DOCS = 'https://dollarpe.mintlify.site'
export const ID = {
  payer: '075986f3-282b-4555-bfcd-fad973e32596',
  beneficiary: '84737c7d-7b62-4204-80d6-80f6ecb3ceb4',
  rdaBeneficiary: '638d9a52-9427-460e-99ba-948d46ce349c',
  bank: 'cab47575-bbcb-4294-81a3-30774104f3b6',
  linkedBank: '4e6f1b20-a73c-11ec-b909-0242ac120002',
  remitter: 'e14fa86f-2a5e-437a-a031-949c68ade933',
  payinQuote: 'da43453c-f854-42ac-9a1e-619b37060bbc',
  payoutQuote: '59bf60c3-e9af-40a7-9d5c-2a1aa191e769',
}
const RISK = {
  ip_address: '203.0.113.10',
  device_id: 'device-123',
  suspicious_activity_report: false,
  law_enforcement_agency_report: false,
}

export function build(o: Opts): Flow | { unsupported: string } {
  const s = market(o.src)
  const d = market(o.dst)
  if (!s && !d) return { unsupported: 'Zapyd converts between fiat and stablecoins. Pick a fiat currency on one side.' }
  if (s && !s.payin)
    return { unsupported: `${s.country} runs payouts only, so ${s.fiat} can't be a source. Pick ${MARKETS.filter((m) => m.payin).map((m) => m.fiat).join(' or ')} as the fiat source.` }
  if (s && d && s.fiat === d.fiat)
    return { unsupported: `Sending ${s.fiat} to ${d.fiat} doesn't need a conversion. Pick a different destination currency.` }

  const groups: Group[] = []
  const edges: Edge[] = []
  const steps: Step[] = []

  // Adds a code step and returns the canvas row that points at it.
  const step = (icon: string, st: Omit<Step, 'n'>, label = st.title, sub?: string): Row => {
    const n = steps.length + 1
    steps.push({ ...st, n })
    const short = st.path?.replace(/^\/\w+\/api\/v1/, '')
    return { id: st.id, icon, label, sub: sub ?? (st.method ? `${st.method} ${short}` : undefined), kind: st.kind, step: n }
  }
  const group = (g: Group) => (groups.push(g), g)
  // KYC sharing reads the organization's KYC requirements before add-kyc-data.
  const kycConfig = (id: string, customerId: string) =>
    step('search', {
      id,
      kind: 'api',
      title: 'Get the KYC requirements',
      text: 'Read the allowed `document_type` values, the `additional_info` keys and `is_tax_required`, and build the KYC form from them. Read it once per customer country.',
      method: 'GET',
      path: `/cms/api/v1/kyc/configuration/${customerId}`,
      docs: '/api-reference-exchange/endpoint/kyc/configuration-{customer_id}',
    }, undefined, 'GET /kyc/configuration/{customer_id}')
  const link = (from: Group | Row, to: Group, tone: Tone = 'gray') =>
    edges.push({ from: 'rows' in from ? from.rows[from.rows.length - 1].id : from.id, to: to.id, tone })

  const asset = s ? (d ? o.bridge : o.dst) : o.src
  const net = NETWORKS[o.network] ?? o.network
  const prefunded = !!d && o.funding === 'prefunded'
  const remit = !!d && o.purpose === 'remittance'
  const rda = remit && d?.fiat === 'INR'

  // ---- source
  let col = 0
  const source = group({
    id: 'g-source',
    col,
    title: 'Source',
    tag: { label: s ? 'Fiat' : 'Stablecoin', tone: 'blue' },
    dashed: true,
    rows: s
      ? [
          { id: 'r-src', icon: `flag:${s.fiat}`, label: `${s.currency}`, sub: `${s.country} bank account`, kind: 'endpoint' },
          { id: 'r-src-method', icon: 'landmark', label: `Pays via ${railName(o.payinMethod)}`, sub: 'Transfer to Zapyd', kind: 'info' },
        ]
      : prefunded
        ? [
            { id: 'r-src', icon: `coin:${asset}`, label: `${asset} balance`, sub: 'Your prefunded wallet', kind: 'endpoint' },
            { id: 'r-src-method', icon: 'vault', label: 'Top up once', sub: 'Each payout debits it', kind: 'info' },
          ]
        : [
            { id: 'r-src', icon: `coin:${asset}`, label: `${asset} on ${net}`, sub: 'Your wallet', kind: 'endpoint' },
            { id: 'r-src-method', icon: 'send', label: 'One transfer per order', sub: 'Sent to the quoted address', kind: 'info' },
          ],
  })

  // ---- payin leg
  let payin: Group | undefined
  let payer: Group | undefined
  if (s?.payin) {
    const p = s.payin
    payer = group({
      id: 'g-payer',
      col,
      title: d ? 'Sender' : 'Customer',
      tag: { label: 'Once per user', tone: 'gray' },
      rows: [
        step('user-plus', {
          id: 'payer-create',
          returns: ID.payer,
          kind: 'api',
          title: 'Create the customer',
          text: `Register the ${s.country} user who pays. Save the returned \`id\` as \`customer_id\`.${s.fiat === 'USD' ? ' US customers need `dob`.' : ''}`,
          method: 'POST',
          path: '/cms/api/v1/customer/create',
          body: p.customer,
          docs: '/api-reference-exchange/endpoint/customer/create',
        }),
        ...(o.kyc === 'sharing' ? [kycConfig('payer-config', ID.payer)] : []),
        o.kyc === 'sharing'
          ? step('id-card', {
              id: 'payer-kyc',
              kind: 'api',
              title: 'Share verified KYC',
              text: 'Send identity data you already verified. The customer moves to `PROCESSING`.',
              method: 'POST',
              path: '/cms/api/v1/kyc/add-kyc-data',
              body: {
                customer_id: ID.payer,
                full_name: p.customer.full_name,
                phone: p.customer.phone,
                full_address: '12 MG Road, Bengaluru, Karnataka 560001',
                dob: '15-08-1992',
                registered_date: '01-01-2025',
                tax_number: 'ABCDE1234F',
                document_type: 'AADHAAR',
                document_details: { document_number: '123412341234' },
                selfie_url: 'https://files.example.com/kyc/selfie.jpg',
              },
              docs: '/guides/customers/kyc-sharing',
            })
          : step('id-card', {
              id: 'payer-kyc',
              kind: 'api',
              title: 'Generate a KYC link',
              text: 'Redirect the user to the returned `url`. They verify on the hosted KYC flow.',
              method: 'POST',
              path: '/cms/api/v1/kyc/generate-link',
              body: { customer_id: ID.payer, redirect_url: 'https://yourapp.com/kyc/return' },
              docs: '/guides/customers/kyc-sdk',
            }),
        step(
          'bell',
          {
            id: 'payer-verified',
            kind: 'event',
            title: 'Wait for VERIFIED',
            text: 'The `CUSTOMER` webhook reports `VERIFIED`. Only then can the customer transact.',
            docs: '/guides/development-and-testing/webhooks',
          },
          'CUSTOMER webhook',
          'status VERIFIED',
        ),
      ],
    })
    col++
    const amount = PAYIN_AMOUNT[s.fiat]
    payin = group({
      id: 'g-payin',
      col,
      title: 'Payin',
      tag: { label: `${s.fiat} to ${asset}`, tone: 'gray' },
      rows: [
        ...(o.payinMethod === 'ACH_PULL'
          ? [
              step(
                'landmark',
                {
                  id: 'payin-link',
                  kind: 'api',
                  title: 'Link the bank account',
                  text: '`ACH_PULL` debits the customer\'s own bank account. Open the returned `widget_url`: the customer signs in to their bank, picks the account and returns to `redirect_url`. No webhook is sent, so poll `GET /cms/api/v1/bank/list/{customer_id}` until the account under `accounts` is `VERIFIED`.',
                  method: 'POST',
                  path: '/cms/api/v1/bank/generate-link',
                  body: { customer_id: ID.payer, redirect_url: 'https://yourapp.com/bank/return' },
                  docs: '/api-reference-exchange/endpoint/bank/generate-link',
                },
                undefined,
              ),
            ]
          : []),
        step('file-invoice', {
          id: 'payin-quote',
          returns: ID.payinQuote,
          kind: 'api',
          title: 'Create a payin quotation',
          text:
            o.payinMethod === 'ACH_PULL'
              ? 'Locks the rate. Send the linked account\'s `id` from the bank list as `bank_id`: `ACH_PULL` debits that account, so the response has no deposit instructions.'
              : `Locks the rate and returns \`deposit_instructions\` and \`expiry_time\`.${o.payinMethod === 'UPI' ? ' For UPI it also returns a `deep_link` you can show as a QR code.' : ''}`,
          method: 'POST',
          path: '/pis/api/v1/payin/quotation',
          body: {
            customer_id: ID.payer,
            asset,
            fiat: s.fiat,
            network: o.network,
            payment_method: o.payinMethod,
            ...(o.payinMethod === 'ACH_PULL' ? { bank_id: ID.linkedBank } : {}),
            sending_amount: amount,
            risk_parameters: RISK,
          },
          docs: '/api-reference-exchange/endpoint/payin/quotation/quotation',
        }, 'Create quotation'),
        step(
          'banknote',
          {
            id: 'payin-pay',
            kind: 'action',
            title: `User pays ${SYMBOL[s.fiat]}${Number(amount).toLocaleString('en-US')}`,
            text:
              o.payinMethod === 'ACH_PULL'
                ? 'Zapyd debits the linked account. The user doesn\'t make a transfer.'
                : `The user sends the exact \`sending_amount\` via ${railName(o.payinMethod)}, from a bank account in their own name, in one transfer, before \`expiry_time\`.${s.fiat === 'INR' ? ' Their bank gives them a 12-digit UTR.' : ' They include the `narrative` from `deposit_instructions` with the transfer.'}`,
            docs: '/guides/payments/payins',
          },
          undefined,
          o.payinMethod === 'ACH_PULL' ? 'Debit from linked account' : `${o.payinMethod} to deposit instructions`,
        ),
        step('arrow-down', {
          id: 'payin-initiate',
          kind: 'api',
          title: 'Initiate the payin',
          text:
            p.reference === 'required'
              ? 'Send the UTR as `transaction_reference_id`. It is required.'
              : '`transaction_reference_id` is optional. Add it if the user has the bank\'s transfer reference.',
          method: 'POST',
          path: '/pis/api/v1/payin/initiate',
          body: {
            quotation_id: ID.payinQuote,
            customer_id: ID.payer,
            client_reference_id: 'payin-001',
            ...(p.reference === 'required' ? { transaction_reference_id: '412345678901' } : {}),
          },
          docs: '/api-reference-exchange/endpoint/payin/order/initiate',
        }),
        step(
          'bell',
          {
            id: 'payin-success',
            kind: 'event',
            title: 'Wait for SUCCESS',
            text: `The \`PAYIN\` webhook moves to \`SUCCESS\` with the \`transaction_hash\`. ${asset} lands in your delivery wallet on ${net}.`,
            docs: '/guides/payments/payins',
          },
          'PAYIN webhook',
          `SUCCESS · ${asset} delivered`,
        ),
      ],
    })
    link(source, payin, 'blue')
    link(payer, payin)
  }

  // ---- onramp ends at the delivery wallet
  if (!d) {
    col++
    const dest = group({
      id: 'g-dest',
      col,
      title: 'Destination',
      tag: { label: 'Stablecoin', tone: 'blue' },
      dashed: true,
      rows: [
        { id: 'r-dst', icon: `coin:${asset}`, label: `${asset} on ${net}`, sub: 'Your delivery wallet', kind: 'endpoint' },
        { id: 'r-dst-ledger', icon: 'wallet', label: 'Credit the user', sub: 'In your own ledger', kind: 'info' },
      ],
    })
    link(payin!, dest, 'green')
    return {
      title: `${s!.fiat} to ${asset}`,
      summary: `Onramp. Collect ${s!.fiat} from ${/^[AEIO]/.test(s!.country) ? 'an' : 'a'} ${s!.country} bank account and receive ${asset} on ${net}.`,
      groups,
      edges,
      steps,
    }
  }

  // ---- payout leg: onboard the beneficiary
  const rail = d.rails.find((r) => r.method === o.rail) ?? d.rails[0]
  const beneficiaryId = rda ? ID.rdaBeneficiary : ID.beneficiary
  const onboardCol = s ? col + 1 : col
  const onboard: Group[] = []

  if (d.onboarding === 'standard') {
    // India: full customer, then /bank/create
    const name = rda ? 'Ravi Kumar' : 'Priya Sharma'
    onboard.push(
      group({
        id: 'g-beneficiary',
        col: onboardCol,
        title: 'Beneficiary',
        tag: { label: 'Once per beneficiary', tone: 'gray' },
        rows: [
          step('user-plus', {
            id: 'ben-create',
            returns: beneficiaryId,
            kind: 'api',
            title: 'Create the beneficiary',
            text: 'The person in India who receives the INR. Save the returned `id` as `customer_id`.',
            method: 'POST',
            path: '/cms/api/v1/customer/create',
            body: { client_reference_id: 'beneficiary-001', full_name: name, phone: '9911002211', alpha_3_country_code: 'IND' },
            docs: '/api-reference-exchange/endpoint/customer/create',
          }),
          ...(!rda && o.kyc === 'sharing' ? [kycConfig('ben-config', beneficiaryId)] : []),
          rda
            ? step('id-card', {
                id: 'ben-kyc',
                kind: 'api',
                title: 'Run beneficiary KYC',
                text: 'Light KYC for cross-border beneficiaries. It replaces full document KYC. `tax_number` (PAN) is optional.',
                method: 'POST',
                path: '/cms/api/v1/kyc/remittance-beneficiary-kyc',
                body: { customer_id: beneficiaryId, tax_number: 'HCDPS3890E' },
                docs: '/api-reference-exchange/endpoint/kyc/remittance-beneficiary-kyc',
              })
            : o.kyc === 'sharing'
              ? step('id-card', {
                  id: 'ben-kyc',
                  kind: 'api',
                  title: 'Share verified KYC',
                  text: 'Send identity data you already verified, then wait for the `CUSTOMER` webhook with `VERIFIED`.',
                  method: 'POST',
                  path: '/cms/api/v1/kyc/add-kyc-data',
                  body: {
                    customer_id: beneficiaryId,
                    full_name: name,
                    phone: '9911002211',
                    full_address: '12 MG Road, Bengaluru, Karnataka 560001',
                    dob: '15-08-1992',
                    registered_date: '01-01-2025',
                    tax_number: 'ABCDE1234F',
                    document_type: 'AADHAAR',
                    document_details: { document_number: '123412341234' },
                    selfie_url: 'https://files.example.com/kyc/selfie.jpg',
                  },
                  docs: '/guides/customers/kyc-sharing',
                })
              : step('id-card', {
                  id: 'ben-kyc',
                  kind: 'api',
                  title: 'Generate a KYC link',
                  text: 'Redirect the beneficiary to the returned `url`, then wait for the `CUSTOMER` webhook with `VERIFIED`.',
                  method: 'POST',
                  path: '/cms/api/v1/kyc/generate-link',
                  body: { customer_id: beneficiaryId, redirect_url: 'https://yourapp.com/kyc/return' },
                  docs: '/guides/customers/kyc-sdk',
                }),
        ],
      }),
    )
    onboard.push(
      group({
        id: 'g-bank',
        col: onboardCol,
        title: 'Bank account',
        tag: { label: rail.method, tone: 'gray' },
        rows: [
          step('landmark', {
            id: 'bank-create',
            returns: ID.bank,
            kind: 'api',
            title: 'Add the bank account',
            text: 'Verified with a penny drop. The holder\'s name must match the KYC name. Save the returned `id` as `bank_id`.',
            method: 'POST',
            path: '/cms/api/v1/bank/create',
            body: { customer_id: beneficiaryId, bank_account_type: rail.method, identifiers: rail.identifiers },
            docs: '/api-reference-exchange/endpoint/bank/create',
          }),
          step(
            'bell',
            {
              id: 'bank-verified',
              kind: 'event',
              title: 'Wait for the bank VERIFIED',
              text: 'The `BANK` webhook reports `VERIFIED`. Quote only against a verified account.',
              docs: '/guides/development-and-testing/webhooks',
            },
            'BANK webhook',
            'status VERIFIED',
          ),
        ],
      }),
    )
  } else {
    // Every other market: payout-only onboarding
    const sm = d.sample!
    const ids = Object.fromEntries(
      (rail.identifiers as string[]).map((k) => [k, sm.ids[k] ?? EXTRA_IDS[d.fiat]?.[k] ?? '']),
    )
    const ben = Object.fromEntries((rail.beneficiary ?? []).map((k) => [k, sm.beneficiary[k] ?? '']))
    onboard.push(
      group({
        id: 'g-beneficiary',
        col: onboardCol,
        title: 'Beneficiary',
        tag: { label: 'Enable first', tone: 'orange', warn: true },
        rows: [
          step('user-plus', {
            id: 'ben-create',
            returns: beneficiaryId,
            kind: 'api',
            title: 'Create the beneficiary',
            text: `Payout-only onboarding skips full KYC. It must be enabled for your organization and for ${d.country}. Save the returned \`id\` as \`customer_id\`.`,
            method: 'POST',
            path: '/cms/api/v1/customer/payout/create',
            body: { client_reference_id: 'beneficiary-001', full_name: sm.name, alpha_3_country_code: d.alpha3 },
            docs: '/guides/customers/payout-only-onboarding',
          }),
          step('id-card', {
            id: 'ben-kyc',
            kind: 'api',
            title: 'Create the KYC profile',
            text: 'Creates the beneficiary\'s payout KYC record.',
            method: 'POST',
            path: '/cms/api/v1/kyc/payout/add-kyc-data',
            body: { customer_id: beneficiaryId },
            docs: '/api-reference-exchange/endpoint/kyc/payout-add-kyc-data',
          }),
          step('map-pin', {
            id: 'ben-address',
            kind: 'api',
            title: 'Add the address',
            text: `${d.country} needs ${d.address.map((a) => `\`${a}\``).join(', ')}${Object.keys(ben).length ? ' and the `beneficiary_identifiers` for this rail' : ''}.`,
            method: 'POST',
            path: '/cms/api/v1/kyc/payout/add-sender-kyc-data',
            body: {
              client_reference_id: 'beneficiary-001',
              country_code: d.alpha3,
              ...sm.address,
              ...(Object.keys(ben).length ? { beneficiary_identifiers: ben } : {}),
            },
            docs: '/api-reference-exchange/endpoint/kyc/payout-add-sender-kyc-data',
          }),
        ],
      }),
    )
    onboard.push(
      group({
        id: 'g-bank',
        col: onboardCol,
        title: 'Bank account',
        tag: { label: rail.method, tone: 'gray' },
        rows: [
          step('landmark', {
            id: 'bank-create',
            returns: ID.bank,
            kind: 'api',
            title: 'Add the bank account',
            text: remit
              ? '`transfer_purpose` and `is_self_transfer: false` mark every payout to this account as cross-border. Save the returned `id` as `bank_id`.'
              : 'Save the returned `id` as `bank_id`.',
            method: 'POST',
            path: '/cms/api/v1/bank/payout/create',
            body: {
              customer_id: beneficiaryId,
              bank_account_type: rail.method,
              identifiers: ids,
              ...(remit ? { transfer_purpose: 'FAMILY_MAINTENANCE', is_self_transfer: false } : {}),
            },
            docs: '/api-reference-exchange/endpoint/bank/payout-create',
          }),
        ],
      }),
    )
  }

  if (rda) {
    const fromUs = s?.fiat === 'USD'
    onboard.push(
      group({
        id: 'g-remitter',
        col: onboardCol,
        title: 'Remitter',
        tag: { label: 'RDA', tone: 'gray' },
        rows: [
          step('user-round', {
            id: 'remitter-create',
            returns: ID.remitter,
            kind: 'api',
            title: 'Create the remitter',
            text: `The sender, living outside India.${s ? ' Use the identity of the customer who paid in.' : ''} Idempotent on \`id_type\` and \`id_number\`. Save the returned \`id\` as \`remitter_id\`.`,
            method: 'POST',
            path: '/cms/api/v1/kyc/remitter/create',
            body: fromUs
              ? {
                  client_reference_id: 'remitter-001',
                  first_name: 'Jane',
                  last_name: 'Doe',
                  dob: '1990-01-15',
                  nationality: 'USA',
                  residence_country: 'USA',
                  city: 'New York',
                  address_line: '350 Fifth Avenue',
                  phone: '+12125550123',
                  source_of_funds: 'salary',
                  id_type: 'PASSPORT',
                  id_number: 'P1234567',
                }
              : {
                  client_reference_id: 'remitter-001',
                  first_name: 'Siva',
                  last_name: 'Raj',
                  dob: '1990-01-15',
                  nationality: 'IND',
                  residence_country: 'ARE',
                  city: 'Dubai',
                  address_line: 'Building 4, Al Barsha 1',
                  phone: '+971501234567',
                  source_of_funds: 'salary',
                  id_type: 'PASSPORT',
                  id_number: 'P1234567',
                },
            docs: '/api-reference-exchange/endpoint/kyc/remitter/create',
          }),
        ],
      }),
    )
  }

  // ---- bridge: the payin's crypto funds the payout
  col = onboardCol
  if (payin) {
    const bridge = group({
      id: 'g-bridge',
      col,
      title: 'Delivery wallet',
      tag: { label: `${asset} on ${net}`, tone: 'blue' },
      dashed: true,
      rows: [
        prefunded
          ? { id: 'r-bridge', icon: 'vault', label: 'Top up the prefunded balance', sub: `Move ${asset} from the delivery wallet`, kind: 'info' }
          : { id: 'r-bridge', icon: `coin:${asset}`, label: `${asset} ready to send`, sub: 'Funds the payout below', kind: 'info' },
      ],
    })
    groups.splice(groups.indexOf(bridge), 1)
    groups.splice(groups.indexOf(onboard[0]), 0, bridge) // bridge sits on top of the column
    link(payin, bridge, 'green')
    onboard.unshift(bridge)
  }

  // ---- quote, fund, initiate
  col++
  const fiatLower = d.fiat.toLowerCase()
  const paymentMethod = rail.payment_method ?? rail.method
  const quoteBody = rda
    ? {
        customer_id: beneficiaryId,
        bank_id: ID.bank,
        remitter_id: ID.remitter,
        asset,
        fiat: d.fiat,
        network: o.network,
        payment_method: 'IMPS',
        receiving_amount: '5100',
        is_self_transfer: false,
        risk_parameters: RISK,
      }
    : {
        customer_id: beneficiaryId,
        bank_id: ID.bank,
        asset: asset.toLowerCase(),
        fiat: fiatLower,
        ...(prefunded ? {} : { network: o.network }),
        payment_method: paymentMethod,
        sending_amount: '60',
        risk_parameters: RISK,
      }
  const quotePath = rda ? '/pos/api/v1/remittance-payout/quotation' : prefunded ? '/pos/api/v1/prefunded/payout/quotation' : '/pos/api/v1/payout/quotation'
  const rows: Row[] = []
  rows.push(
    step('file-invoice', {
      id: 'payout-quote',
      returns: ID.payoutQuote,
      kind: 'api',
      title: rda ? 'Create a cross-border quotation' : 'Create a payout quotation',
      text: [
        rda ? 'Send exactly one amount: `receiving_amount` fixes the INR the beneficiary gets, `sending_amount` fixes the crypto.' : '',
        d.fiat === 'INR'
          ? ''
          : prefunded
            ? `\`payment_method\` is the bank account's method (\`${paymentMethod}\`). [\`GET /pos/api/v1/prefunded/payout/configuration\`](${DOCS}/api-reference-exchange/endpoint/prefunded-payout/configuration) lists the methods and limits for ${d.fiat}.`
            : `\`payment_method\` is the bank account's method (\`${paymentMethod}\`). [\`GET /pos/api/v1/payout/configuration\`](${DOCS}/api-reference-exchange/endpoint/payout/config/configuration) lists the methods and limits for ${d.fiat}.`,
        prefunded && !rda ? '`network` is ignored: the quotation uses your prefunded wallet\'s network.' : '',
        prefunded && rda ? '`network` must match your prefunded wallet\'s network.' : '',
        prefunded ? '' : 'The response has the `wallet_address` to fund and `expiry_time`.',
      ]
        .filter(Boolean)
        .join(' '),
      method: 'POST',
      path: quotePath,
      body: quoteBody,
      docs: rda
        ? '/api-reference-exchange/endpoint/remittance-payout/quotation'
        : prefunded
          ? '/api-reference-exchange/endpoint/prefunded-payout/quotation'
          : '/api-reference-exchange/endpoint/payout/quotation/quotation',
    }, 'Create quotation'),
  )
  if (prefunded)
    rows.push(
      step('scale', {
        id: 'payout-balance',
        kind: 'api',
        title: 'Check the balance',
        text: `Compare the quotation's \`sending_amount\` with \`available_balance.${asset}\`. Top up first if it's too low.`,
        method: 'GET',
        path: '/pos/api/v1/payout/balance',
        docs: '/api-reference-exchange/endpoint/remittance-payout/balance',
      }),
    )
  else
    rows.push(
      step(
        'send',
        {
          id: 'payout-send',
          kind: 'action',
          title: `Send ${asset} on ${net}`,
          text: `Send exactly \`sending_amount\` of ${asset}${payin ? ' from your delivery wallet' : ''}, on ${net}, to the quotation's \`wallet_address\`. Keep the transaction hash.`,
          docs: '/guides/payments/payouts',
        },
        undefined,
        'To the quoted wallet_address',
      ),
    )
  const initBody = rda
    ? {
        quotation_id: ID.payoutQuote,
        customer_id: beneficiaryId,
        remitter_id: ID.remitter,
        client_reference_id: 'remit-001',
        ...(prefunded ? {} : { transaction_hash: '0x9f2c3b1a...' }),
      }
    : prefunded
      ? {
          quotation_id: ID.payoutQuote,
          customer: { sender: { id: payin ? ID.payer : beneficiaryId }, receiver: { id: beneficiaryId } },
          client_reference_id: 'payout-001',
        }
      : { quotation_id: ID.payoutQuote, customer_id: beneficiaryId, client_reference_id: 'payout-001', transaction_hash: '0x9f2c3b1a...' }
  rows.push(
      step('arrow-up', {
        id: 'payout-initiate',
        kind: 'api',
        title: rda ? 'Initiate the cross-border payout' : 'Initiate the payout',
        text: prefunded
          ? rda
            ? 'Initiate without a hash. Zapyd reserves the amount from your balance.'
            : `\`receiver.id\` must be the quotation's customer. \`sender.id\` is the customer who starts the transfer and pays for it: ${payin ? 'the customer whose payin funded it' : 'here the beneficiary, cashing out to their own account'}. Zapyd reserves the amount from your balance.`
          : 'Send the `transaction_hash` of your transfer. The payout starts as `PROCESSING`.',
        method: 'POST',
        path: rda ? '/pos/api/v1/remittance-payout/initiate' : prefunded ? '/pos/api/v1/prefunded/payout/initiate' : '/pos/api/v1/payout/initiate',
        body: initBody,
        docs: rda
          ? '/api-reference-exchange/endpoint/remittance-payout/initiate'
          : prefunded
            ? '/api-reference-exchange/endpoint/prefunded-payout/initiate'
            : '/api-reference-exchange/endpoint/payout/order/initiate',
      }),
      step(
        'bell',
        {
          id: 'payout-success',
          kind: 'event',
          title: 'Wait for SUCCESS',
          text: `The \`PAYOUT\` webhook moves to \`SUCCESS\`${d.fiat === 'INR' ? ' with the bank `utr`. Show it to the user as proof of payment' : ''}. Every event carries your \`client_reference_id\`.`,
          docs: '/guides/payments/payouts',
        },
        'PAYOUT webhook',
        d.fiat === 'INR' ? 'SUCCESS · utr' : 'status SUCCESS',
      ),
  )
  const payout = group({
    id: 'g-payout',
    col,
    title: rda ? 'Cross-border' : 'Payout',
    tag: prefunded ? { label: 'Prefunded', tone: 'blue' } : { label: `${asset} to ${d.fiat}`, tone: 'gray' },
    rows,
  })
  onboard.forEach((g) => link(g, payout, g.id === 'g-bridge' ? 'green' : 'gray'))
  if (!payin) link(source, payout, 'blue')

  col++
  const dest = group({
    id: 'g-dest',
    col,
    title: 'Destination',
    tag: { label: s ? 'Cross-border' : 'Fiat', tone: 'blue' },
    dashed: true,
    rows: [
      { id: 'r-dst', icon: `flag:${d.fiat}`, label: d.currency, sub: `${d.country} bank account`, kind: 'endpoint' },
      { id: 'r-dst-rail', icon: 'landmark', label: `Paid via ${railName(rail.method)}`, sub: rda ? 'Settled through RDA' : remit ? 'FAMILY_MAINTENANCE' : 'Payout', kind: 'info' },
    ],
  })
  link(payout, dest, 'green')

  const kindLabel = rda ? 'Cross-border transfer through RDA' : s ? 'Cross-border transfer' : 'Offramp'
  const to = `${d.fiat} to ${/^[AEIO]/.test(d.country) ? 'an' : 'a'} ${d.country} bank account via ${railName(rail.method)}`
  return {
    title: s ? `${s.fiat} to ${d.fiat}` : `${asset} to ${d.fiat}`,
    summary: `${kindLabel}. ${
      s
        ? `Collect ${s.fiat} as ${asset} on ${net}, ${prefunded ? 'top up your prefunded balance, ' : ''}then pay out ${to}.`
        : prefunded
          ? `Pay out ${to}, from your prefunded ${asset} balance.`
          : `Send ${asset} on ${net} and pay out ${to}.`
    }`,
    groups,
    edges,
    steps,
  }
}

export const docsUrl = (path?: string) => (path ? (path.startsWith('http') ? path : DOCS + path) : undefined)
