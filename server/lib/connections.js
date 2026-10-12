/**
 * What is connected to each product: its listings, and the returns attached to it, grouped the way imports
 * match them (by listing ID, else SKU, else the platform's product title). Each group says how it was matched,
 * so mix-ups can be found and moved to the right product.
 */
import { logActivity } from './activity.js';
import { HttpError } from './http.js';
import { CHANNELS } from '../../shared/workflow.js';

// What identifies a group of returns: the listing ID if there is one, else the SKU, else the product title.
const GROUP_KEY = "COALESCE(NULLIF(lower(r.external_id), ''), NULLIF(lower(r.sku), ''), r.product_label)";

export async function productConnections(db) {
  const [{ rows: products }, { rows: listings }, { rows: groups }] = await Promise.all([
    db.query('SELECT id, name, model, category, lifecycle, source, odyssey_id FROM products ORDER BY name'),
    db.query(
      `SELECT l.id, l.product_id, l.channel, l.external_id, l.sku, l.state,
              COALESCE((SELECT sum(r.quantity) FROM returns r
                         WHERE r.product_id = l.product_id AND r.channel = l.channel
                           AND ((l.external_id <> '' AND lower(r.external_id) = lower(l.external_id))
                             OR (l.external_id = '' AND l.sku <> '' AND lower(r.sku) = lower(l.sku)))), 0)::int AS units
         FROM product_listings l ORDER BY l.channel, l.external_id, l.sku`,
    ),
    db.query(
      `SELECT r.product_id, r.channel, ${GROUP_KEY} AS key,
              max(r.external_id) AS external_id, max(r.sku) AS sku,
              (array_agg(r.product_label ORDER BY r.return_date DESC))[1] AS product_label,
              count(DISTINCT r.product_label)::int AS titles,
              count(*)::int AS returns, sum(r.quantity)::int AS units,
              min(r.return_date)::text AS first_date, max(r.return_date)::text AS last_date
         FROM returns r
        GROUP BY r.product_id, r.channel, ${GROUP_KEY}
        ORDER BY units DESC, key`,
    ),
  ]);

  // How each group got its product: a listing on that product, a listing on another product (a mix-up), or a guess.
  const listingFor = (g) =>
    listings.find(
      (l) =>
        l.channel === g.channel &&
        ((l.external_id && g.external_id && l.external_id.toLowerCase() === g.external_id.toLowerCase()) ||
          (!l.external_id && l.sku && g.sku && l.sku.toLowerCase() === g.sku.toLowerCase())),
    );
  const names = new Map(products.map((p) => [p.id, p.name]));
  for (const g of groups) {
    const l = listingFor(g);
    if (!g.product_id) g.via = 'unmatched';
    else if (!l) g.via = 'guess';
    else if (l.product_id === g.product_id) g.via = 'listing';
    else Object.assign(g, { via: 'conflict', listing_product_id: l.product_id, listing_product_name: names.get(l.product_id) });
  }
  return { products, listings, groups };
}

/**
 * Move one group of returns from a product to another, or back to unmatched (`toProductId` null). The group's
 * listing moves with it, so later imports follow; sending it back to unmatched removes that listing from the
 * product, so the next import asks again.
 */
export async function moveReturns(tx, { fromProductId, channel, external_id, sku, product_label, toProductId, userId }) {
  if (!Object.hasOwn(CHANNELS, channel)) throw new HttpError(400, 'Unknown channel');
  if (fromProductId === toProductId) throw new HttpError(400, 'Pick a different product');
  const { rows: products } = await tx.query('SELECT id, name FROM products WHERE id = ANY($1::uuid[])', [[fromProductId, toProductId].filter(Boolean)]);
  const from = products.find((p) => p.id === fromProductId);
  const to = toProductId ? products.find((p) => p.id === toProductId) : null;
  if (!from || (toProductId && !to)) throw new HttpError(404, 'Product not found');

  let match;
  if (external_id) match = ['lower(external_id) = lower($4)', external_id];
  else if (sku) match = ["external_id = '' AND lower(sku) = lower($4)", sku];
  else if (product_label) match = ["external_id = '' AND sku = '' AND product_label = $4", product_label];
  else throw new HttpError(400, 'Say which returns: a listing ID, SKU or product title');

  const { rowCount } = await tx.query(`UPDATE returns SET product_id = $1 WHERE product_id = $2 AND channel = $3 AND ${match[0]}`, [
    toProductId,
    fromProductId,
    channel,
    match[1],
  ]);

  let listing = 'none';
  if (external_id || sku) {
    const where = external_id ? "lower(external_id) = lower($2)" : "external_id = '' AND lower(sku) = lower($2)";
    const { rows: found } = await tx.query(`SELECT id, product_id FROM product_listings WHERE channel = $1 AND ${where}`, [channel, external_id || sku]);
    const mine = found.filter((l) => l.product_id === fromProductId);
    if (to) {
      if (mine.length) {
        await tx.query('UPDATE product_listings SET product_id = $1, updated_at = now() WHERE id = ANY($2::uuid[])', [to.id, mine.map((l) => l.id)]);
        listing = 'moved';
      } else if (!found.some((l) => l.product_id === to.id)) {
        await tx.query(
          `INSERT INTO product_listings (product_id, channel, external_id, sku, state, created_by) VALUES ($1, $2, $3, $4, 'live', $5)
           ON CONFLICT DO NOTHING`,
          [to.id, channel, external_id || '', sku || '', userId],
        );
        listing = 'added';
      }
    } else if (mine.length) {
      await tx.query('DELETE FROM product_listings WHERE id = ANY($1::uuid[])', [mine.map((l) => l.id)]);
      listing = 'removed';
    }
  }

  const label = [CHANNELS[channel], external_id || sku || product_label].join(' ');
  await logActivity(tx, {
    entityType: 'product',
    entityId: from.id,
    action: 'returns_moved',
    changes: { label: from.name, returns: label, rows: rowCount, to: to ? to.name : 'Unmatched', listing },
    userId,
  });
  if (to) {
    await logActivity(tx, {
      entityType: 'product',
      entityId: to.id,
      action: 'returns_moved_in',
      changes: { label: to.name, returns: label, rows: rowCount, from: from.name, listing },
      userId,
    });
  }
  return { moved: rowCount, listing };
}
