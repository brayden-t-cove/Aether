/**
 * Read the customer-match workbook in the browser and keep only each return's ID and match confidence.
 * Names, phone numbers, emails and addresses in the file are never read into the result, so they
 * never leave the uploader's computer.
 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ID_HEADERS = ['returnorderid', 'returnid', 'returnrequestid'];
const CONFIDENCE_HEADERS = ['matchconfidence', 'confidence'];
const STATUS_HEADERS = ['matchstatus'];

/** The workbook's reason a return couldn't be matched → 'no_activation', 'order_not_found', or null. */
export function unmatchedReason(status) {
  const s = String(status ?? '').toLowerCase();
  if (/no activation/.test(s)) return 'no_activation';
  if (/order not found/.test(s)) return 'order_not_found';
  return null;
}

/**
 * sheets: [{ sheet: name, data: [[cells]] }] as read-excel-file returns them.
 * A sheet with a return ID and a confidence column gives that confidence; a sheet with a return ID and
 * "unmatched" in its name (the workbook's "Unmatched Returns" tab) gives "unmatched", with why from its
 * Match Status column ("No activation found for zip", "Order not found…"). Others are skipped.
 * → { matches: [{ return_ref, confidence, unmatched_reason? }], used: [{ sheet, rows }] }
 */
export function extractMatches(sheets) {
  const matches = [];
  const used = [];
  for (const { sheet, data } of sheets) {
    // The header is the first row that names a return ID column (a title row may come before it).
    const headerAt = data.findIndex((row) => row?.some((cell) => ID_HEADERS.includes(norm(cell))));
    if (headerAt < 0) continue;
    const header = data[headerAt].map(norm);
    const idCol = header.findIndex((h) => ID_HEADERS.includes(h));
    const confCol = header.findIndex((h) => CONFIDENCE_HEADERS.includes(h));
    const statusCol = header.findIndex((h) => STATUS_HEADERS.includes(h));
    const unmatchedTab = /unmatched/i.test(sheet);
    if (confCol < 0 && !unmatchedTab) continue;

    let rows = 0;
    for (const row of data.slice(headerAt + 1)) {
      const ref = String(row?.[idCol] ?? '').trim();
      if (!ref) continue;
      if (confCol >= 0) matches.push({ return_ref: ref, confidence: String(row[confCol] ?? '').trim() });
      else matches.push({ return_ref: ref, confidence: 'unmatched', unmatched_reason: statusCol >= 0 ? unmatchedReason(row[statusCol]) : null });
      rows++;
    }
    used.push({ sheet, rows });
  }
  return { matches, used };
}

/** Read an .xlsx File. The spreadsheet reader is loaded only when someone uploads a workbook. */
export async function readMatchWorkbook(file) {
  const { default: readExcelFile } = await import('read-excel-file/browser');
  return extractMatches(await readExcelFile(file));
}
