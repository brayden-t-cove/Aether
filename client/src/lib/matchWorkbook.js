/**
 * Read the customer-match workbook in the browser and keep only each return's ID and match confidence.
 * Names, phone numbers, emails and addresses in the file are never read into the result, so they
 * never leave the uploader's computer.
 */

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ID_HEADERS = ['returnorderid', 'returnid', 'returnrequestid'];
const CONFIDENCE_HEADERS = ['matchconfidence', 'confidence'];

/**
 * sheets: [{ sheet: name, data: [[cells]] }] as read-excel-file returns them.
 * A sheet with a return ID and a confidence column gives that confidence; a sheet with a return ID and
 * "unmatched" in its name (the workbook's "Unmatched Returns" tab) gives "unmatched". Others are skipped.
 * → { matches: [{ return_ref, confidence }], used: [{ sheet, rows }] }
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
    const unmatchedTab = /unmatched/i.test(sheet);
    if (confCol < 0 && !unmatchedTab) continue;

    let rows = 0;
    for (const row of data.slice(headerAt + 1)) {
      const ref = String(row?.[idCol] ?? '').trim();
      if (!ref) continue;
      matches.push({ return_ref: ref, confidence: confCol >= 0 ? String(row[confCol] ?? '').trim() : 'unmatched' });
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
