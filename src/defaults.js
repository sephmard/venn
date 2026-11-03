// A signed-in account's default templates (GET and PUT /api/me/defaults, and `defaults` in GET
// /api/me): one brand template for date polls and one for votes, each optional. The account must
// own the template or have been given it (an invite link): knowing its public /new?brand= link
// isn't enough. Each default is checked again whenever it's read; one whose template was deleted,
// or that the account no longer has, is cleared then, so a default never points somewhere it
// can't go. Which template a new poll starts with (an explicit link first, then a draft or copy,
// then the default, then plain Venn) is the create page's choice (public/create.js).

import { ValidationError } from '../public/core.js';
import { BRAND_ID_RE } from './brands.js';

export const DEFAULT_FORMATS = ['date', 'vote'];

/** Whether account `userId` may use brand template `brandId` as a default: it owns it or has it. */
export async function mayUseTemplate(store, userId, brandId) {
  if (!(await store.getBrand(brandId))) return false;
  return (await store.ownerOf('brand', brandId)) === userId || !!(await store.brandRole(brandId, userId));
}

/**
 * `{ date: { id, name } | null, vote: … }` for account `userId`. `brands` is the account's list
 * (store.listOwnedBrands), when the caller has it already; a default not in it is checked on its
 * own (the list is capped) and cleared if the account can't use it any more.
 */
export async function readDefaults(store, userId, brands = null) {
  const out = { date: null, vote: null };
  const list = brands || (await store.listOwnedBrands(userId));
  for (const { format, brandId } of await store.listDefaults(userId)) {
    if (!DEFAULT_FORMATS.includes(format)) continue;
    const listed = list.find((b) => b.id === brandId);
    if (listed) {
      out[format] = { id: brandId, name: listed.name };
      continue;
    }
    if (await mayUseTemplate(store, userId, brandId)) {
      out[format] = { id: brandId, name: (await store.getBrand(brandId)).name };
      continue;
    }
    await store.setDefault(userId, format, null); // gone, or no longer theirs: cleared
  }
  return out;
}

/**
 * PUT /api/me/defaults `{ format: 'date' | 'vote', template: id | null }`: set or clear one.
 * Returns null when done, or [status, message] when it can't be.
 */
export async function writeDefault(store, userId, body, now) {
  const format = body?.format;
  if (!DEFAULT_FORMATS.includes(format)) throw new ValidationError("Say which kind of poll: 'date' or 'vote'");
  const template = body.template ?? null;
  if (template !== null && (typeof template !== 'string' || !BRAND_ID_RE.test(template)))
    throw new ValidationError('That isn’t a template');
  if (template && !(await mayUseTemplate(store, userId, template)))
    return [403, 'Only a template in your account can be your default. Add it first, then try again.'];
  await store.setDefault(userId, format, template, now);
  return null;
}
