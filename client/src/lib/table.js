// Parsing lives in shared/table.js, so the server reads reports from marketplace APIs the same way.
import { decodeText } from '../../../shared/table.js';

export { decodeText, parseTable } from '../../../shared/table.js';

/** A JSON import file: { products, projects }, or just a list of products. */
export function parseImportJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return { products: data, projects: [] };
  return { products: data.products || [], projects: data.projects || [] };
}

/** A file's text (see decodeText). */
export async function readText(file) {
  return decodeText(await file.arrayBuffer());
}

