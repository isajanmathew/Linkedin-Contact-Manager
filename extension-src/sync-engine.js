/**
 * Sync engine: local writes flush to Supabase through a durable outbox, and
 * remote changes arrive over Realtime (never polling). Timestamps decide
 * conflicts — the newest modified_at wins.
 */

import { log, warn, logError } from './config.js';
import { getSupabase, resetSupabase, ownerFingerprint } from './supabase-client.js';
import {
  applyRemoteRows,
  enqueue,
  getContactMap,
  getDeviceKey,
  getMeta,
  getOutbox,
  markContactDeletedLocal,
  markSynced,
  patchMeta,
  saveContactLocal,
  setOutbox,
  toRow,
} from './local-store.js';

const MAX_ATTEMPTS = 8;
const FLUSH_DEBOUNCE_MS = 400;
const BACKOFF_ALARM = 'sync-retry';
const HEARTBEAT_ALARM = 'sync-heartbeat';

let channel = null;
let subscribedKey = null;
let flushTimer = null;
let flushing = false;

function isTransient(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return (
    !navigator.onLine ||
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econn') ||
    message.includes('load failed') ||
    message.includes('too many requests')
  );
}

function backoffMinutes(attempts) {
  return Math.min(30, Math.max(1, Math.pow(2, Math.max(0, attempts - 1))));
}

async function scheduleRetry(attempts) {
  await chrome.alarms.create(BACKOFF_ALARM, { delayInMinutes: backoffMinutes(attempts) });
}

/* ------------------------------- mutations ------------------------------ */

export async function saveContact(input) {
  const contact = await saveContactLocal(input);
  const pending = await enqueue('upsert', contact.id);
  scheduleFlush();
  return { success: true, contact, pending };
}

export async function deleteContact(id) {
  const contact = await markContactDeletedLocal(id);
  if (!contact) return { success: false, error: 'Contact not found' };
  await enqueue('delete', id);
  scheduleFlush();
  return { success: true };
}

export function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushOutbox().catch(logError);
  }, FLUSH_DEBOUNCE_MS);
}

/* --------------------------------- push -------------------------------- */

export async function flushOutbox() {
  if (flushing) return { skipped: true };
  const ownerKey = await getDeviceKey();
  if (!ownerKey) return { skipped: true, reason: 'no-device-key' };

  const supabase = await getSupabase(ownerKey);
  if (!supabase) return { skipped: true, reason: 'no-connection' };
  let ops = await getOutbox();
  if (!ops.length) return { pushed: 0 };

  if (!navigator.onLine) {
    await patchMeta({ lastError: 'Offline — changes queued locally', connected: false });
    return { skipped: true, reason: 'offline' };
  }

  flushing = true;
  let pushed = 0;

  try {
    const contacts = await getContactMap();
    const remaining = [];

    for (const op of ops) {
      const contact = contacts[op.contactId];
      if (!contact) continue;

      try {
        if (op.type === 'delete') {
          const { error } = await supabase.from('contacts').delete().eq('id', op.contactId);
          if (error) throw error;
          await markSynced(op.contactId, new Date().toISOString());
        } else {
          const row = toRow(contact, ownerKey);
          // Update-then-insert instead of upsert: an upsert on
          // (owner_key, profile_url) would rewrite the remote row's primary key
          // with our local id, breaking record continuity for other devices.
          // The modified_at filter is the conflict rule — a remote row edited
          // more recently than our local copy wins and is pulled instead.
          const { id: _localId, ...updatable } = row;
          const { data: updated, error: updateError } = await supabase
            .from('contacts')
            .update(updatable)
            .eq('owner_key', ownerKey)
            .eq('profile_url', row.profile_url)
            .lte('modified_at', row.modified_at)
            .select('id, modified_at');
          if (updateError) throw updateError;

          if (updated && updated.length > 0) {
            await markSynced(op.contactId, updated[0].modified_at, updated[0].id);
          } else {
            const { data: existing, error: existingError } = await supabase
              .from('contacts')
              .select('id, modified_at')
              .eq('owner_key', ownerKey)
              .eq('profile_url', row.profile_url)
              .maybeSingle();
            if (existingError) throw existingError;

            if (existing) {
              // Remote is newer: discard this push and let the pull apply it.
              await markSynced(op.contactId, existing.modified_at, existing.id);
            } else {
              const { data: inserted, error: insertError } = await supabase
                .from('contacts')
                .insert(row)
                .select('id, modified_at')
                .single();
              if (insertError) throw insertError;
              await markSynced(op.contactId, inserted.modified_at, inserted.id);
            }
          }
        }

        pushed += 1;
      } catch (error) {
        if (isTransient(error) && op.attempts + 1 < MAX_ATTEMPTS) {
          remaining.push({ ...op, attempts: op.attempts + 1, lastError: error.message });
          await scheduleRetry(op.attempts + 1);
          await patchMeta({ lastError: `Retrying: ${error.message}`, connected: false });
        } else {
          // Permanent rejection (bad device key, constraint violation). Drop the
          // op so one bad record cannot block the queue, but surface it.
          logError('Dropping unsyncable operation', op, error);
          await patchMeta({ lastError: error.message || 'Sync rejected by server' });
        }
      }
    }

    await setOutbox(remaining);
    if (pushed && !remaining.length) {
      await patchMeta({ lastPushedAt: new Date().toISOString(), lastError: null, connected: true });
    }
    log(`pushed ${pushed} change(s), ${remaining.length} queued`);
    return { pushed, queued: remaining.length };
  } finally {
    flushing = false;
    ops = null;
  }
}

/* --------------------------------- pull -------------------------------- */

export async function pullChanges({ full = false } = {}) {
  const ownerKey = await getDeviceKey();
  if (!ownerKey) return { skipped: true, reason: 'no-device-key' };
  if (!navigator.onLine) return { skipped: true, reason: 'offline' };

  const supabase = await getSupabase(ownerKey);
  if (!supabase) return { skipped: true, reason: 'no-connection' };
  const meta = await getMeta();
  const since = full ? null : meta.lastPulledAt;

  try {
    let query = supabase.from('contacts').select('*').order('modified_at', { ascending: true });
    if (since) query = query.gt('modified_at', since);

    const { data, error } = await query;
    if (error) throw error;

    const { applied } = await applyRemoteRows(data || []);
    const newest = data?.length ? data[data.length - 1].modified_at : meta.lastPulledAt;
    await patchMeta({
      lastPulledAt: newest || new Date().toISOString(),
      lastError: null,
      connected: true,
    });
    if (applied) notifyPanels();
    log(`pulled ${data?.length || 0} row(s), applied ${applied}`);
    return { fetched: data?.length || 0, applied };
  } catch (error) {
    const message = error.message || 'Pull failed';
    await patchMeta({ lastError: message, connected: false });
    if (isTransient(error)) await scheduleRetry(1);
    warn('pull failed', message);
    return { error: message };
  }
}

/* ------------------------------- realtime ------------------------------- */

/**
 * Realtime carries only change markers (no contact data), so a notification
 * triggers an RLS-scoped delta pull rather than trusting the payload.
 */
export async function subscribeRealtime() {
  const ownerKey = await getDeviceKey();
  if (!ownerKey) {
    await teardownRealtime();
    return;
  }
  if (subscribedKey === ownerKey && channel) return;

  await teardownRealtime();

  const supabase = await getSupabase(ownerKey);
  if (!supabase) return { skipped: true, reason: 'no-connection' };
  const fingerprint = await ownerFingerprint(ownerKey);
  subscribedKey = ownerKey;

  channel = supabase
    .channel(`contacts-sync-${fingerprint.slice(0, 12)}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'sync_events',
        filter: `owner_fingerprint=eq.${fingerprint}`,
      },
      () => {
        pullChanges().catch(logError);
      },
    )
    .subscribe(async (status) => {
      log('realtime status', status);
      await patchMeta({ connected: status === 'SUBSCRIBED' });
      if (status === 'SUBSCRIBED') {
        await pullChanges();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        await chrome.alarms.create(BACKOFF_ALARM, { delayInMinutes: 1 });
      }
    });
}

export async function teardownRealtime() {
  if (channel) {
    const supabase = await getSupabase(subscribedKey);
    try {
      await supabase?.removeChannel(channel);
    } catch (error) {
      warn('removeChannel failed', error);
    }
  }
  channel = null;
  subscribedKey = null;
}

export async function setDeviceKey(key) {
  const { setDeviceKey: persist } = await import('./local-store.js');
  await persist(key);
  resetSupabase();
  await teardownRealtime();
  await patchMeta({ lastPulledAt: null, lastError: null, connected: false });
  if (!key?.trim()) return { success: true, connected: false };

  const result = await pullChanges({ full: true });
  await subscribeRealtime();
  await flushOutbox();
  return { success: !result.error, error: result.error, connected: !result.error };
}

/* ------------------------------ lifecycle ------------------------------ */

export function notifyPanels() {
  chrome.runtime.sendMessage({ action: 'contactsUpdated' }).catch(() => {
    /* no side panel open */
  });
}

export async function startSync() {
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  await subscribeRealtime();
  await flushOutbox();
}

/**
 * The worker can be evicted at any time, so the heartbeat re-establishes the
 * Realtime channel and drains the outbox. It is a reconnect guard, not a data
 * poll: contact reads still arrive through Realtime notifications.
 */
export async function onAlarm(alarm) {
  if (alarm.name === HEARTBEAT_ALARM) {
    if (!channel) await subscribeRealtime();
    await flushOutbox();
  } else if (alarm.name === BACKOFF_ALARM) {
    await subscribeRealtime();
    await flushOutbox();
    await pullChanges();
  }
}
