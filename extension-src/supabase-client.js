import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

/**
 * One client per device key. The key travels as the x-owner-key header, which
 * the RLS policies compare against contacts.owner_key, so a client without a
 * key can read nothing.
 */
let cached = { key: null, client: null };

export function getSupabase(ownerKey) {
  if (!ownerKey) return null;
  if (cached.key === ownerKey && cached.client) return cached.client;

  cached = {
    key: ownerKey,
    client: createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: { headers: { 'x-owner-key': ownerKey } },
      realtime: { params: { eventsPerSecond: 5 } },
    }),
  };
  return cached.client;
}

export function resetSupabase() {
  cached = { key: null, client: null };
}

/** Fingerprint published alongside change markers; sha256 matches the DB trigger. */
export async function ownerFingerprint(ownerKey) {
  const bytes = new TextEncoder().encode(ownerKey);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
