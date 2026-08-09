/**
 * Local-first store. chrome.storage.local is the single source of truth for
 * every read in the UI; Supabase is a replica that we push to and pull from.
 *
 * Shapes
 *   contacts : { [id]: Contact }
 *   outbox   : Operation[]   (ordered, replayed FIFO)
 *   syncMeta : { lastPulledAt, lastPushedAt, lastError, pendingCount, connected }
 */

import { logError } from './config.js';

export const KEYS = {
  contacts: 'contacts',
  outbox: 'outbox',
  meta: 'syncMeta',
  deviceKey: 'deviceKey',
  tagUsage: 'tagSuggestions',
  supabaseUrl: 'supabaseUrl',
  supabaseAnonKey: 'supabaseAnonKey',
};

const CONTACT_FIELDS = [
  'fullName',
  'jobTitle',
  'company',
  'location',
  'email',
  'phone',
  'profileUrl',
  'profilePicture',
  'tags',
  'notes',
  'contactDate',
  'followUpDate',
];

async function get(keys) {
  return chrome.storage.local.get(keys);
}

async function set(items) {
  return chrome.storage.local.set(items);
}

export async function getDeviceKey() {
  const data = await get([KEYS.deviceKey]);
  return data[KEYS.deviceKey] || '';
}

export async function setDeviceKey(key) {
  await set({ [KEYS.deviceKey]: (key || '').trim() });
}

export async function getContactMap() {
  const data = await get([KEYS.contacts]);
  return data[KEYS.contacts] || {};
}

export async function setContactMap(map) {
  await set({ [KEYS.contacts]: map });
}

export async function listContacts() {
  const map = await getContactMap();
  return Object.values(map)
    .filter((c) => !c.deletedAt)
    .sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
}

export function normalizeProfileUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = 'www.linkedin.com';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}

export async function findContactByUrl(profileUrl) {
  const target = normalizeProfileUrl(profileUrl);
  if (!target) return null;
  const map = await getContactMap();
  return (
    Object.values(map).find(
      (c) => !c.deletedAt && normalizeProfileUrl(c.profileUrl) === target,
    ) || null
  );
}

function sanitizeTags(tags) {
  const source = Array.isArray(tags)
    ? tags
    : String(tags || '')
        .split(',')
        .map((t) => t.trim());
  const seen = new Set();
  const out = [];
  source.forEach((tag) => {
    const value = typeof tag === 'string' ? tag.trim().slice(0, 100) : '';
    const dedupeKey = value.toLowerCase();
    if (value && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      out.push(value);
    }
  });
  return out;
}

/**
 * Write a contact locally and return the stored record. This is the only write
 * path the UI uses — it never waits on the network.
 */
export async function saveContactLocal(input) {
  const map = await getContactMap();
  const now = new Date().toISOString();
  const existing =
    (input.id && map[input.id]) ||
    Object.values(map).find(
      (c) => normalizeProfileUrl(c.profileUrl) === normalizeProfileUrl(input.profileUrl),
    ) ||
    null;

  const contact = {
    ...(existing || {}),
    id: existing?.id || input.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || now,
    modifiedAt: now,
    deletedAt: null,
    pendingSync: true,
    remoteModifiedAt: existing?.remoteModifiedAt || null,
  };

  CONTACT_FIELDS.forEach((field) => {
    if (field === 'tags') {
      contact.tags = sanitizeTags(input.tags ?? existing?.tags ?? []);
    } else if (input[field] !== undefined) {
      contact[field] = typeof input[field] === 'string' ? input[field].trim() : input[field];
    } else if (existing?.[field] !== undefined) {
      contact[field] = existing[field];
    } else {
      contact[field] = '';
    }
  });

  contact.profileUrl = normalizeProfileUrl(contact.profileUrl);

  map[contact.id] = contact;
  await setContactMap(map);
  await recordTagUsage(contact.tags);
  return contact;
}

export async function markContactDeletedLocal(id) {
  const map = await getContactMap();
  const existing = map[id];
  if (!existing) return null;
  existing.deletedAt = new Date().toISOString();
  existing.modifiedAt = existing.deletedAt;
  existing.pendingSync = true;
  map[id] = existing;
  await setContactMap(map);
  return existing;
}

export async function markSynced(id, remoteModifiedAt, remoteId) {
  const map = await getContactMap();
  const contact = map[id];
  if (!contact) return;

  if (remoteId && remoteId !== id) {
    // Supabase merged this into an existing row (same owner + profile URL).
    // Re-key locally so future ops target the surviving row.
    delete map[id];
    contact.id = remoteId;
    map[remoteId] = contact;
  }

  contact.pendingSync = false;
  contact.remoteModifiedAt = remoteModifiedAt || contact.modifiedAt;
  if (contact.deletedAt) {
    delete map[contact.id];
  }
  await setContactMap(map);
}

/* ------------------------------- outbox ------------------------------- */

export async function getOutbox() {
  const data = await get([KEYS.outbox]);
  return data[KEYS.outbox] || [];
}

export async function setOutbox(ops) {
  await set({ [KEYS.outbox]: ops });
  await patchMeta({ pendingCount: ops.length });
}

/**
 * Queue an operation. Only the newest op per contact matters, so an existing
 * queued op for the same contact is collapsed rather than duplicated.
 */
export async function enqueue(type, contactId) {
  const ops = await getOutbox();
  const filtered = ops.filter((op) => op.contactId !== contactId);
  filtered.push({
    opId: crypto.randomUUID(),
    type,
    contactId,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  });
  await setOutbox(filtered);
  return filtered.length;
}

/* -------------------------------- meta -------------------------------- */

export async function getMeta() {
  const data = await get([KEYS.meta]);
  return {
    lastPulledAt: null,
    lastPushedAt: null,
    lastError: null,
    pendingCount: 0,
    connected: false,
    ...(data[KEYS.meta] || {}),
  };
}

export async function patchMeta(patch) {
  const current = await getMeta();
  const next = { ...current, ...patch };
  await set({ [KEYS.meta]: next });
  return next;
}

/* ------------------------------ tag usage ----------------------------- */

export async function recordTagUsage(tags) {
  const list = sanitizeTags(tags);
  if (!list.length) return;
  try {
    const data = await get([KEYS.tagUsage]);
    const usage = data[KEYS.tagUsage] || {};
    const now = Date.now();
    list.forEach((tag) => {
      const entry = usage[tag] || { count: 0, firstUsed: now };
      entry.count += 1;
      entry.lastUsed = now;
      usage[tag] = entry;
    });
    await set({ [KEYS.tagUsage]: usage });
  } catch (error) {
    logError('Failed to record tag usage', error);
  }
}

/**
 * Tag suggestions come from local data only: every tag on a stored contact,
 * plus historical usage counts. No network round trip, no remote vocabulary.
 */
export async function getTagOptions() {
  const [contacts, data] = await Promise.all([listContacts(), get([KEYS.tagUsage])]);
  const usage = data[KEYS.tagUsage] || {};
  const counts = new Map();

  Object.entries(usage).forEach(([tag, entry]) => {
    counts.set(tag, entry.count || 1);
  });
  contacts.forEach((contact) => {
    (contact.tags || []).forEach((tag) => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ---------------------------- row conversion --------------------------- */

const emptyToNull = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed === '' || trimmed === undefined ? null : trimmed;
};

export function toRow(contact, ownerKey) {
  return {
    id: contact.id,
    owner_key: ownerKey,
    full_name: emptyToNull(contact.fullName),
    job_title: emptyToNull(contact.jobTitle),
    company: emptyToNull(contact.company),
    location: emptyToNull(contact.location),
    email: emptyToNull(contact.email),
    phone: emptyToNull(contact.phone),
    profile_url: normalizeProfileUrl(contact.profileUrl),
    profile_picture: emptyToNull(contact.profilePicture),
    tags: sanitizeTags(contact.tags),
    notes: emptyToNull(contact.notes),
    contact_date: emptyToNull(contact.contactDate),
    follow_up_date: emptyToNull(contact.followUpDate),
    deleted_at: contact.deletedAt || null,
    modified_at: contact.modifiedAt,
  };
}

export function fromRow(row) {
  return {
    id: row.id,
    fullName: row.full_name || '',
    jobTitle: row.job_title || '',
    company: row.company || '',
    location: row.location || '',
    email: row.email || '',
    phone: row.phone || '',
    profileUrl: row.profile_url || '',
    profilePicture: row.profile_picture || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes || '',
    contactDate: row.contact_date || '',
    followUpDate: row.follow_up_date || '',
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    remoteModifiedAt: row.modified_at,
    deletedAt: row.deleted_at || null,
    pendingSync: false,
  };
}

/**
 * Merge rows pulled from Supabase into the local store.
 * Conflict rule: newest modifiedAt wins. A contact with a queued local edit is
 * never overwritten — its pending op will be pushed and become the winner.
 */
export async function applyRemoteRows(rows) {
  if (!rows?.length) return { applied: 0 };
  const [map, outbox] = await Promise.all([getContactMap(), getOutbox()]);
  const pendingIds = new Set(outbox.map((op) => op.contactId));
  let applied = 0;

  rows.forEach((row) => {
    const incoming = fromRow(row);
    const local = map[incoming.id];

    if (local && (pendingIds.has(local.id) || local.pendingSync)) return;
    if (local && (local.modifiedAt || '') >= (incoming.modifiedAt || '')) return;

    if (incoming.deletedAt) {
      delete map[incoming.id];
    } else {
      map[incoming.id] = incoming;
    }
    applied += 1;
  });

  if (applied) await setContactMap(map);
  return { applied };
}
