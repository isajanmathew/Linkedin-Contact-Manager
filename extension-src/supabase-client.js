import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY } from './config.js';
import { getConnection } from './local-store.js';

/**
 * One client per (project URL, anon key, device key) triple. The device key
 * travels as the x-owner-key header, which the RLS policies compare against
 * contacts.owner_key, so a client without a key can read nothing.
 */
let cached = { signature: null, client: null };

export function getDefaultConnection() {
  return { url: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_SUPABASE_PUBLISHABLE_KEY };
}

export async function getSupabase(ownerKey) {
  if (!ownerKey) return null;

  const stored = await getConnection();
  const url = (stored.url || DEFAULT_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anonKey = (stored.anonKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !anonKey) return null;

  const signature = `${url}|${anonKey}|${ownerKey}`;
  if (cached.signature === signature && cached.client) return cached.client;

  cached = {
    signature,
    client: createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
      global: { headers: { 'x-owner-key': ownerKey } },
      realtime: { params: { eventsPerSecond: 5 } },
    }),
  };
  return cached.client;
}

export function resetSupabase() {
  cached = { signature: null, client: null };
}

/** Fingerprint published alongside change markers; sha256 matches the DB trigger. */
export async function ownerFingerprint(ownerKey) {
  const bytes = new TextEncoder().encode(ownerKey);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
