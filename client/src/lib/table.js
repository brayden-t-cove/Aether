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

/** A JSON import file: { products, projects }, or just a list of products. */
export function parseImportJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return { products: data, projects: [] };
  return { products: data.products || [], projects: data.projects || [] };
}
