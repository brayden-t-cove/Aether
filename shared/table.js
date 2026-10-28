/**
 * Reading spreadsheet text, used by the browser (pasted or uploaded reports) and the server (reports fetched from
 * marketplace APIs), so both read a report the same way.
 */

/**
 * Parse pasted spreadsheet text or a CSV/TSV file into row objects keyed by
 * the header row. Tabs win if the header has any (what Excel and Google
 * Sheets put on the clipboard); otherwise commas. Handles quoted fields.
 */
export function parseTable(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}


/**
 * Bytes as text. Most exports are UTF-8; Amazon's reports are Windows-1252, which would garble
 * accents and curly quotes if read as UTF-8, so fall back to it when the bytes aren't valid UTF-8.
 */
// Windows-1252's characters at 0x80–0x9F (curly quotes, dashes, €…). Browsers decode them, but Node's decoder may
// treat windows-1252 as Latin-1 and give invisible control characters instead, so they're mapped here.
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹',
  0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™',
  0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

export function decodeText(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer).replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0)] ?? c);
  }
}
