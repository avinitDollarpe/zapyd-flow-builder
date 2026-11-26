/**
 * Endpoint for the rates page: appends each request-access form to the "Requests" tab and each rate card
 * form (kind "rates": name, company, email, phone) to the "Rate card" tab of the same Google Sheet.
 *
 * Setup (about 5 minutes):
 *   1. Create a Google Sheet. Open Extensions > Apps Script, delete the sample code and paste this file.
 *   2. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy and authorise.
 *   3. Copy the web app URL (ends in /exec) into REQUEST_URL in public/rates/index.html.
 *   After editing this script, use Deploy > Manage deployments > Edit > New version, or the URL keeps serving
 *   the old code.
 *
 * The page posts JSON as text/plain (a simple request, so no CORS preflight) and expects { ok: true }.
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

  // Bots fill the hidden "fax" field; pretend success and store nothing
  if (data.fax) return reply({ ok: true })

  const email = clean(data.email, 200)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ ok: false, error: 'invalid_email' })

  if (data.kind === 'rates') {
    const phone = clean(data.phone, 30)
    if (!clean(data.name, 120) || !clean(data.company, 120)) return reply({ ok: false, error: 'missing_fields' })
    if (!/^\+?[\d\s().-]{7,25}$/.test(phone) || phone.replace(/\D/g, '').length < 7) return reply({ ok: false, error: 'invalid_phone' })
    append(RATES_SHEET, RATES_HEADERS, [
      new Date(), cell(data.name, 120), cell(data.company, 120), cell(email, 200), cell(phone, 30), cell(data.country, 80),
    ])
    return reply({ ok: true })
  }

  const website = siteUrl(data.website)
  if (!clean(data.country, 80) || !website) return reply({ ok: false, error: 'missing_fields' })
  if (FLOWS.indexOf(data.flow) < 0 || VOLUMES.indexOf(data.volume) < 0) return reply({ ok: false, error: 'invalid_choice' })

  append(SHEET_NAME, HEADERS, [
    new Date(), cell(data.country, 80), data.flow, data.volume, website, cell(email, 200), cell(data.notes, 1000),
  ])
  return reply({ ok: true })
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

function siteUrl(v) {
  v = clean(v, 300); if (!v) return ''
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v
  return /^https?:\/\/[^\s/?#]+\.[^\s/?#]{2,}([/?#]\S*)?$/i.test(v) ? v : ''
}

function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max) }

// Visitor text must never run as a formula when the sheet is opened: prefix anything that starts like one
function cell(v, max) { const s = clean(v, max); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s }

function reply(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON) }
