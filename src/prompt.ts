// The "AI agent" tab: one prompt that tells a coding agent everything it needs
// to build the selected flow. It mirrors the API reference prompts in the docs
// repo (scripts/gen-endpoint-prompts.py): keep the signing and webhook rules in step.
import { docsUrl, type Flow, type Step } from './flow'

const PROD = 'https://api.zapyd.com'
const SANDBOX = 'https://sandbox.zapyd.com'

// Sample IDs in the step bodies, shown to the agent as the value it must wire in.
const PLACEHOLDERS: Record<string, string> = {
  '075986f3-282b-4555-bfcd-fad973e32596': '<customer_id from "Create the customer">',
  '84737c7d-7b62-4204-80d6-80f6ecb3ceb4': '<beneficiary customer_id>',
  '638d9a52-9427-460e-99ba-948d46ce349c': '<beneficiary customer_id>',
  'cab47575-bbcb-4294-81a3-30774104f3b6': '<bank_id>',
  '4e6f1b20-a73c-11ec-b909-0242ac120002': '<id of the linked account from GET /cms/api/v1/bank/list/{customer_id}>',
  'e14fa86f-2a5e-437a-a031-949c68ade933': '<remitter_id>',
  'da43453c-f854-42ac-9a1e-619b37060bbc': '<payin quotation id>',
  '59bf60c3-e9af-40a7-9d5c-2a1aa191e769': '<payout quotation id>',
  '0x9f2c3b1a...': '<hash of your on-chain transfer>',
  '412345678901': "<UTR from the user's bank>",
}

const body = (b: unknown) => JSON.stringify(b, (_, v) => (typeof v === 'string' && PLACEHOLDERS[v]) || v)

const plain = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

// What to do in sandbox instead of waiting for the real world.
function sandbox(st: Step, flow: Flow): string | undefined {
  const inr = flow.title.startsWith('INR')
  switch (st.id) {
    case 'payer-verified':
      return 'set it with `PATCH /cms/api/v1/kyc/mock-kyc-status` `{"customer_id": "...", "kyc_status": "VERIFIED"}`. It sends the same `CUSTOMER` webhook. Test `DOCUMENT_VERIFICATION_FAILED` too.'
    case 'ben-kyc':
      return st.path?.endsWith('/kyc/add-kyc-data') || st.path?.endsWith('/kyc/generate-link')
        ? 'set the result with `PATCH /cms/api/v1/kyc/mock-kyc-status` `{"customer_id": "...", "kyc_status": "VERIFIED"}`.'
        : undefined
    case 'ben-create':
      return st.path?.endsWith('/customer/payout/create')
        ? 'payout-only onboarding must be enabled for the country in sandbox too. Ask support if this returns an error.'
        : undefined
    case 'bank-verified':
      return 'set it with `POST /cms/api/v1/bank/mock-bank-verification` `{"customer_id": "...", "bank_id": "...", "bank_status": "VERIFIED"}`. It sends no webhook: read the account with `GET /cms/api/v1/bank/{customer_id}/{bank_id}`.'
    case 'payin-link':
      return 'the hosted page isn\'t available for test customers. Call `POST /cms/api/v1/bank/mock-bank-verification` `{"customer_id": "...", "bank_status": "VERIFIED"}` without `bank_id`: it creates a linked account that `GET /cms/api/v1/bank/list/{customer_id}` returns.'
    case 'payin-pay':
      return inr ? 'no real transfer. Any 12-digit `transaction_reference_id` works.' : 'no real transfer is needed.'
    case 'payin-success':
      return 'set it with `PATCH /pis/api/v1/payin/mock-payin-status` `{"payin_id": "...", "payin_status": "SUCCESS"}`. Test `FAILED`, `ON_HOLD` and `REFUNDED` too.'
    case 'payout-quote':
      return st.path?.includes('/prefunded/') ? undefined : 'quote on `network: "sepolia"` to get a testnet `wallet_address`.'
    case 'payout-send':
      return 'send testnet USDT or USDC on Sepolia (get Sepolia ETH for gas from a faucet). Never send real funds to a sandbox address.'
    case 'payout-success':
      return 'set it with `PATCH /pos/api/v1/payout/mock-payout-status` `{"payout_id": "...", "payout_status": "SUCCESS"}` while the payout is `PROCESSING`. Test `FAILED` and `REFUNDED` too.'
  }
}

export function prompt(flow: Flow) {
  const has = (id: string) => flow.steps.some((s) => s.id === id)
  const path = (id: string) => flow.steps.find((s) => s.id === id)?.path ?? ''
  const payin = has('payin-quote')
  const prefunded = has('payout-balance')
  const payout = has('payout-quote')
  const rda = path('payout-quote').includes('/remittance-payout/')
  const types = [
    'CUSTOMER',
    ...(has('bank-verified') ? ['BANK'] : []),
    ...(payin ? ['PAYIN'] : []),
    ...(payout ? ['PAYOUT'] : []),
  ]

  const out = [
    `Build this Zapyd flow in my backend: ${flow.title}. ${flow.summary}`,
    '',
    'Setup:',
    `- Base URL: \`${SANDBOX}\` (sandbox) or \`${PROD}\` (production). Paths are the same; credentials are separate per environment.`,
    '- Config from `ZAPYD_API_KEY`, `ZAPYD_API_SECRET` and `ZAPYD_BASE_URL`. Every Zapyd call runs on the server. The secret never reaches a browser or app.',
    '- Every response is `{status, message, data, err_code, errors}`. When `status` is false, raise an error with the HTTP status, `err_code` and `errors`. Retry only 429 and 5xx, with exponential backoff from 1 s (capped at 30 s, at most 5 attempts). 401 `AUTH_*` means a signing, timestamp or key bug: fix it, don\'t retry.',
    '- Amounts are strings. Assets, networks and payment methods come from the quotation and configuration responses, never hardcoded.',
    '',
    'Signing (every request):',
    '- Headers `X-API-KEY`, `X-TIMESTAMP` (Unix seconds, within 300 s of server time, new per request) and `X-SIGNATURE` = Base64(HMAC-SHA256(key = API secret, message = apiKey + "|" + timestamp + "|" + canonicalBody)).',
    '- canonicalBody: the JSON body with keys sorted at every nesting level, no whitespace, non-ASCII escaped as lowercase `\\uXXXX` (Python `json.dumps(body, sort_keys=True, separators=(",", ":"))`). GET requests sign `{}`; query parameters aren\'t signed. Send the exact string you signed as the body.',
    '- Test vector: key `3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d`, secret `test-secret-do-not-use`, timestamp `1735689600`. Signing `{}` gives `6sCtVSRQjU9+2/af8gdwUAvY1l6Ii6ENcbRfanPkhY0=`. Body `{"customer_id":"78c99d71-f28f-47a9-8302-93b286efbe0e","amount":100.5,"currency":"INR","meta":{"note":"Café","b":2,"a":1}}` gives `l+DvQrzlKbsOSxSYOdWoWHEehcFRZfDJPKlLDkm2cSI=`.',
    '',
    'Webhooks (set up before the first order):',
    '- Register one public HTTPS URL once per environment: `POST /org/api/v1/organizations/api-webhooks` `{"webhook_url": "https://yourapp.com/webhooks/zapyd"}`. It receives every event type.',
    '- Each event is `{type, id, event, timestamp, metadata}`, where `id` is the object\'s Zapyd ID. Verify it before reading: `X-TIMESTAMP` within 300 s, and `X-SIGNATURE` computed like a request signature over the canonical JSON of the body, with your own key and secret. Compare in constant time; reject with 401.',
    '- Return 2xx within a few seconds and process asynchronously. Events can repeat: store `id` + `event` and skip duplicates.',
    `- This flow uses ${types.map((t) => `\`${t}\``).join(', ')} events. Drive every "Wait for" step below from them, and fall back to polling the object (at most once a minute) if an event is late.`,
    '',
    'Steps, in order. Values in <angle brackets> are IDs saved from earlier steps; other values are samples to replace with real data.',
  ]

  for (const st of flow.steps) {
    const head = st.method ? `\`${st.method} ${st.path}\`` : st.kind === 'event' ? 'webhook' : 'user or wallet action'
    out.push(`${st.n}. ${st.title} (${head}): ${plain(st.text)}`)
    if (st.body) out.push(`   Body: ${body(st.body)}`)
    const sb = sandbox(st, flow)
    if (sb) out.push(`   Sandbox: ${sb}`)
    if (st.docs && st.method) out.push(`   Reference: ${docsUrl(st.docs)}.md`)
  }

  out.push('', 'Before each order:')
  if (payin)
    out.push('- Read `GET /pis/api/v1/payin/configuration` (cache daily) and call `GET /ren/api/v1/payin/limits/{customer_id}`. If `available_limit` doesn\'t cover the amount, collect EDD (`POST /ren/api/v1/payin/edd/save`) when `is_edd_required` is true, otherwise block until `full_limit_reset_timestamp`.')
  if (payout)
    out.push(
      rda
        ? '- Read `GET /pos/api/v1/payout/configuration` (cache daily) for the INR payment methods, limits and `required_risk_parameters`.'
        : '- Read the payout configuration (cache daily) and call `GET /ren/api/v1/payout/limits/{customer_id}` for the beneficiary. Handle EDD the same way.',
    )
  out.push(
    '- `risk_parameters`: send every key the configuration lists in `required_risk_parameters`, with the end user\'s real `ip_address` and `device_id`.',
    '- Quotations expire at `expiry_time`. If one expires, create a new one; never reuse it.',
  )

  out.push('', 'Failure handling:')
  out.push('- `CUSTOMER` `FAILED`: read `metadata.failure_reason`, let the user fix that part (each customer has 3 KYC attempts). `KYC_FAILED` is final.')
  if (has('bank-verified')) out.push('- `BANK` `FAILED` (`NAME_MISMATCH`, `PENNY_DROP_FAILED`, `ACCOUNT_TYPE_NRE` …): ask for another account in the beneficiary\'s own name.')
  if (payin) out.push('- `PAYIN`: credit only on `SUCCESS`. On `FAILED` (`INCORRECT_UTR`, `PAYMENT_NOT_RECEIVED`), `REFUND_INITIATED` or `REFUNDED`, tell the user and stop the flow. `ON_HOLD` is under review: don\'t credit, and contact support with the payin `id`.')
  if (payout)
    out.push(
      '- `PAYOUT` `IN_REVIEW`: send the user to `metadata.rfi_link` when present, otherwise wait. `FAILED` and `REFUNDED` are final; the reason is always the generic `Payout failed`. No webhook is sent for `PROCESSING`.',
      `- On a timeout or 5xx from the payout initiate call, look the payout up in ${prefunded && !rda ? '`GET /pos/api/v1/prefunded/payout/history`' : '`GET /pos/api/v1/payout/history`'} before retrying${prefunded ? '' : ': a hash that already funded a payout is rejected'}.`,
    )

  out.push(
    '',
    'Deliver:',
    '1. A small typed Zapyd client: the signer (unit-tested against the test vector), one function per call above, and typed errors.',
    '2. The webhook endpoint: signature check, deduplication, and a handler per event type.',
    `3. The flow as an idempotent state machine, persisted per order: store every ID above, plus a unique \`client_reference_id\` per customer and order${payout ? ' and the payout `utr` on success' : ''}. Each step advances on its webhook, so a restart or a repeated event never repeats a money movement.`,
    '4. An end-to-end test against sandbox that drives each step with the mock endpoints, including at least one failure path.',
    '',
    'Docs for agents: `https://docs.zapyd.com/llms.txt`. Add `.md` to any docs URL for Markdown.',
  )
  return out.join('\n')
}
