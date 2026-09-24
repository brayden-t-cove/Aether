import { HttpError } from './http.js';

/**
 * Small field validators. Each reads body[key] only when present, so the
 * same schema serves create (with `required`) and partial update.
 * A schema is { key: validatorFn }; parse() returns only the keys that were sent.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (label, msg) => {
  throw new HttpError(400, `${label} ${msg}`);
};

export const v = {
  text:
    ({ label, required = false, max = 500 } = {}) =>
    (value) => {
      if (value === null || value === undefined) value = '';
      if (typeof value !== 'string') fail(label, 'must be text');
      value = value.trim();
      if (required && !value) fail(label, 'is required');
      if (value.length > max) fail(label, `must be at most ${max} characters`);
      return value;
    },

  /** Text that is stored as NULL when blank (e.g. SKU, which is unique). */
  nullableText:
    ({ label, max = 200 } = {}) =>
    (value) => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string') fail(label, 'must be text');
      value = value.trim();
      if (value.length > max) fail(label, `must be at most ${max} characters`);
      return value || null;
    },

  oneOf:
    (allowed, { label } = {}) =>
    (value) => {
      const keys = Array.isArray(allowed) ? allowed : Object.keys(allowed);
      if (!keys.includes(value)) fail(label, `must be one of: ${keys.join(', ')}`);
      return value;
    },

  date:
    ({ label } = {}) =>
    (value) => {
      if (value === null || value === undefined || value === '') return null;
      if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
        fail(label, 'must be a date (YYYY-MM-DD)');
      }
      return value;
    },

  id:
    ({ label, required = false } = {}) =>
    (value) => {
      if (value === null || value === undefined || value === '') {
        if (required) fail(label, 'is required');
        return null;
      }
      if (typeof value !== 'string' || !UUID_RE.test(value)) fail(label, 'is not a valid ID');
      return value;
    },

  list:
    ({ label, max = 20 } = {}) =>
    (value) => {
      if (value === null || value === undefined) return [];
      if (typeof value === 'string') value = value.split(/[;,]/);
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) fail(label, 'must be a list');
      const items = [...new Set(value.map((x) => x.trim()).filter(Boolean))];
      if (items.length > max) fail(label, `can have at most ${max} entries`);
      return items;
    },

  url:
    ({ label } = {}) =>
    (value) => {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value !== 'string') fail(label, 'must be text');
      value = value.trim();
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        fail(label, 'must be a full link starting with https://');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) fail(label, 'must start with http:// or https://');
      return value;
    },

  int:
    ({ label, min = 0, max = 100_000 } = {}) =>
    (value) => {
      if (!Number.isInteger(value) || value < min || value > max) fail(label, `must be a whole number from ${min} to ${max}`);
      return value;
    },
};

/**
 * Validate `body` against `schema`, returning only the keys that were sent.
 * Keys listed in `required` are always checked, so a missing one fails
 * (e.g. a create without a name). Unsent optional keys fall back to defaults.
 */
export function parse(body, schema, { required = [] } = {}) {
  body = body && typeof body === 'object' ? body : {};
  const out = {};
  for (const [key, check] of Object.entries(schema)) {
    if (key in body || required.includes(key)) out[key] = check(body[key]);
  }
  return out;
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
