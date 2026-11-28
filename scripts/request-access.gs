/**
 * Endpoint for the rates page: appends each request-access form to the "Requests" tab and each rate card
 * form (kind "rates": name, company, email, phone) to the "Rate card" tab of the same Google Sheet. The rate card
 * form asks for the email first (kind "lookup"): an email already on the "Rate card" tab sees the rates at once.
 *
 * Setup (about 5 minutes):
 *   1. Create a Google Sheet. Open Extensions > Apps Script, delete the sample code and paste this file.
 *   2. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy and authorise.
 *   3. Copy the web app URL (ends in /exec) into REQUEST_URL in public/rates/index.html.
 *   After editing this script, use Deploy > Manage deployments > Edit > New version, or the URL keeps serving
 *   the old code.
 *
 * The page posts JSON as text/plain (a simple request, so no CORS preflight) and expects { ok: true }. Spam: a hidden
 * honeypot field, a time trap (`elapsed` under 2.5 s), the page's work email and phone checks, and one row per
 * person (and country) every 10 minutes.
 */
const SHEET_NAME = 'Requests'
const HEADERS = ['Received', 'Country', 'Flow', 'Monthly volume', 'Website', 'Email', 'Notes']
const RATES_SHEET = 'Rate card'
const RATES_HEADERS = ['Received', 'Name', 'Company', 'Email', 'Phone', 'Country']
const FLOWS = ['payout', 'payin', 'both']
const VOLUMES = ['Under $100K', '$100K to $1M', '$1M to $10M', 'Over $10M']

function doPost(e) {
  let data
  try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}') } catch (err) { return reply({ ok: false, error: 'bad_json' }) }

  // Bots fill the hidden "fax" field or send the form within a couple of seconds of opening it: pretend success and
  // store nothing. The lookup has no time trap: an autofilled email is sent at once
  if (data.fax || (data.kind !== 'lookup' && Number(data.elapsed) < 2500)) return reply({ ok: true })

  const email = clean(data.email, 200).toLowerCase()
  const problem = emailProblem(email)
  if (problem) return reply({ ok: false, error: problem })

  // Answers only yes or no: nothing stored for the email is sent back
  if (data.kind === 'lookup') return reply({ ok: true, known: known(email) })

  if (data.kind === 'rates') {
    const phone = clean(data.phone, 30)
    if (!clean(data.name, 120) || !clean(data.company, 120)) return reply({ ok: false, error: 'missing_fields' })
    if (phoneProblem(phone)) return reply({ ok: false, error: 'invalid_phone' })
    if (seen('rates:' + email)) return reply({ ok: true })   // the same person again within 10 minutes: one row
    append(RATES_SHEET, RATES_HEADERS, [
      new Date(), cell(data.name, 120), cell(data.company, 120), cell(email, 200), cell(phone, 30), cell(data.country, 80),
    ])
    return reply({ ok: true })
  }

  const website = siteUrl(data.website)
  if (!clean(data.country, 80) || !website) return reply({ ok: false, error: 'missing_fields' })
  if (FLOWS.indexOf(data.flow) < 0 || VOLUMES.indexOf(data.volume) < 0) return reply({ ok: false, error: 'invalid_choice' })

  if (seen('request:' + email + ':' + clean(data.country, 80))) return reply({ ok: true })
  append(SHEET_NAME, HEADERS, [
    new Date(), cell(data.country, 80), data.flow, data.volume, website, cell(email, 200), cell(data.notes, 1000),
  ])
  return reply({ ok: true })
}

// True when the "Rate card" tab already has a row with this email (column D)
function known(email) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RATES_SHEET)
  if (!sheet || sheet.getLastRow() < 2) return false
  return sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).getValues().some(r => String(r[0]).trim().toLowerCase() === email)
}

function append(name, headers, row) {
  const lock = LockService.getScriptLock()
  lock.waitLock(10000)                       // serialise appends so concurrent requests can't interleave rows
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet()
    const sheet = book.getSheetByName(name) || book.insertSheet(name)
    if (sheet.getLastRow() === 0) { sheet.appendRow(headers); sheet.setFrozenRows(1) }
    sheet.appendRow(row)
  } finally {
    lock.releaseLock()
  }
}

// The page's checks again (public/rates/index.html), since anyone can post here: a work email, not a personal or
// throwaway inbox; a phone as +<country code> <number>, 7 to 15 digits, not one repeated digit or a 0123456789 run.
const FREE_MAIL = ('gmail googlemail yahoo ymail rocketmail hotmail outlook live msn icloud me mac aol proton protonmail pm gmx ' +
  'yandex zoho zohomail rediffmail mail inbox tutanota tuta fastmail hey web qq 163 126 sina naver daum hanmail rambler seznam libero ' +
  'comcast.net verizon.net att.net sbcglobal.net btinternet.com sky.com orange.fr free.fr laposte.net t-online.de wp.pl o2.pl interia.pl bk.ru list.ru').split(' ')
const DISPOSABLE = ('mailinator guerrillamail sharklasers grr 10minutemail tempmail temp-mail yopmail trashmail getnada nada dispostable ' +
  'maildrop mailnesia throwawaymail fakeinbox mintemail mohmal emailondeck tempr discard spamgourmet burnermail moakt 33mail mytemp ' +
  'tempinbox mailcatch spambox mailpoof tempmailo emailfake fakemail inboxkitten 1secmail').split(' ')

function emailProblem(email) {
  const m = email.match(/^[a-z0-9](?:[a-z0-9._%+'-]{0,62}[a-z0-9])?@((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})$/)
  if (!m || email.indexOf('..') >= 0) return 'invalid_email'
  const domain = m[1], parts = domain.split('.'), name = parts[0], rest = parts.slice(1).join('.')
  if (/\.(test|example|invalid|localhost|local)$/.test(domain) || /^example\.(com|net|org)$/.test(domain)) return 'invalid_email'
  if (DISPOSABLE.indexOf(name) >= 0) return 'disposable_email'
  if (FREE_MAIL.indexOf(domain) >= 0 || (FREE_MAIL.indexOf(name) >= 0 && /^(?:(?:co|com|net|org|ac)\.)?[a-z]{2,3}$/.test(rest))) return 'personal_email'
  return ''
}

function phoneProblem(phone) {
  const m = phone.match(/^\+(\d{1,4}) ([\d\s().-]+)$/)
  if (!m) return 'invalid_phone'
  const n = m[2].replace(/\D/g, '')
  if ((m[1] + n).length < 7 || (m[1] + n).length > 15 || /^(\d)\1+$/.test(n)) return 'invalid_phone'
  if (n.length >= 7 && ('01234567890123456789'.indexOf(n) >= 0 || '98765432109876543210'.indexOf(n) >= 0)) return 'invalid_phone'
  return ''
}

// True when this key was seen in the last 10 minutes (then a repeat stores nothing)
function seen(key) {
  const cache = CacheService.getScriptCache(), k = Utilities.base64EncodeWebSafe(key).slice(0, 240)
  if (cache.get(k)) return true
  cache.put(k, '1', 600)
  return false
}

function siteUrl(v) {
  v = clean(v, 300); if (!v) return ''
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]{2,}([/?#]\S*)?$/i.test(v) ? v : ''
}

function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max) }

// Visitor text must never run as a formula when the sheet is opened: prefix anything that starts like one
function cell(v, max) { const s = clean(v, max); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s }

function reply(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON) }
