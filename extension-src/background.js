/**
 * Service worker. Owns the Supabase connection and the sync engine; the side
 * panel and content script only ever talk to it via messages.
 */

import { log, logError } from './config.js';
import {
  findContactByUrl,
  getConnection,
  getDefaultQuarterlySetting,
  getDeviceKey,
  getMeta,
  getTagOptions,
  listContacts,
  setDefaultQuarterlySetting,
} from './local-store.js';
import { getDefaultConnection } from './supabase-client.js';
import {
  deleteContact,
  flushOutbox,
  onAlarm,
  pullChanges,
  saveContact,
  setConnection,
  setDeviceKey,
  startSync,
  subscribeRealtime,
  updateBadge,
} from './sync-engine.js';

async function handleMessage(request) {
  switch (request.action) {
    case 'getSyncState': {
      const [meta, deviceKey, stored, defaultQuarterly] = await Promise.all([
        getMeta(),
        getDeviceKey(),
        getConnection(),
        getDefaultQuarterlySetting(),
      ]);
      const defaults = getDefaultConnection();
      return {
        success: true,
        ...meta,
        hasDeviceKey: Boolean(deviceKey),
        online: navigator.onLine,
        supabaseUrl: stored.url || defaults.url || '',
        hasAnonKey: Boolean(stored.anonKey || defaults.anonKey),
        defaultQuarterlyReminder: defaultQuarterly,
      };
    }

    case 'getDefaultSettings': {
      const defaultQuarterly = await getDefaultQuarterlySetting();
      return { success: true, defaultQuarterlyReminder: defaultQuarterly };
    }

    case 'setDefaultSettings': {
      if (request.defaultQuarterlyReminder !== undefined) {
        await setDefaultQuarterlySetting(request.defaultQuarterlyReminder);
      }
      return { success: true };
    }

    case 'getDueReconnects': {
      const contacts = await listContacts();
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const todayEnd = new Date(todayStr + 'T23:59:59.999Z');

      const dueContacts = [];
      contacts.forEach((contact) => {
        if (contact.followUpDate) {
          const followUp = new Date(contact.followUpDate + 'T23:59:59.999Z');
          if (!isNaN(followUp.getTime()) && followUp <= todayEnd) {
            dueContacts.push({
              ...contact,
              dueType: 'followUp',
              dueDate: contact.followUpDate,
            });
          }
        } else if (contact.quarterlyReminder !== false) {
          const baseDateStr = contact.contactDate || contact.createdAt || contact.modifiedAt;
          if (baseDateStr) {
            const base = new Date(baseDateStr);
            if (!isNaN(base.getTime())) {
              const nextQuarter = new Date(base.getTime() + 90 * 24 * 60 * 60 * 1000);
              if (nextQuarter <= todayEnd) {
                dueContacts.push({
                  ...contact,
                  dueType: 'quarterly',
                  dueDate: nextQuarter.toISOString().split('T')[0],
                });
              }
            }
          }
        }
      });
      return { success: true, count: dueContacts.length, contacts: dueContacts };
    }

    case 'updateBadge': {
      await updateBadge();
      return { success: true };
    }

    case 'setConnection':
      return setConnection({ url: request.url, anonKey: request.anonKey });

    case 'setDeviceKey':
      return setDeviceKey(request.deviceKey);


    case 'saveContact':
      return saveContact(request.data);

    case 'deleteContact':
      return deleteContact(request.id);

    case 'getContacts':
      return { success: true, contacts: await listContacts() };

    case 'getContactByUrl': {
      const contact = await findContactByUrl(request.profileUrl);
      return { success: true, exists: Boolean(contact), contact };
    }

    // Used by the floating button injected on LinkedIn profiles.
    case 'checkContactExists': {
      const contact = await findContactByUrl(request.profileUrl);
      const conn = await getConnection();
      const configured = Boolean((conn.url || getDefaultConnection().url) && (conn.anonKey || getDefaultConnection().anonKey));
      return { exists: Boolean(contact), configured, id: contact?.id || null };
    }

    case 'getTagOptions':
      return { success: true, options: await getTagOptions() };

    case 'syncNow': {
      const pull = await pullChanges({ full: Boolean(request.full) });
      const push = await flushOutbox();
      await subscribeRealtime();
      const meta = await getMeta();
      return { success: !pull.error, pull, push, ...meta };
    }

    case 'openSidePanelFromButton': {
      const tabId = request.tabId;
      if (!tabId) return { success: false, error: 'No tab context' };
      await chrome.sidePanel.open({ tabId });
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown action: ${request.action}` };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const enriched =
    request?.action === 'openSidePanelFromButton'
      ? { ...request, tabId: request.tabId || sender.tab?.id }
      : request;

  handleMessage(enriched)
    .then(sendResponse)
    .catch((error) => {
      logError('message handler failed', request?.action, error);
      sendResponse({ success: false, error: error.message || 'Unexpected error' });
    });
  return true; // async response
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (error) {
      logError('Failed to open side panel', error);
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  onAlarm(alarm).catch(logError);
});

chrome.runtime.onStartup.addListener(() => {
  log('startup');
  startSync().catch(logError);
});

chrome.runtime.onInstalled.addListener(() => {
  log('installed');
  startSync().catch(logError);
});

// Cold start of the worker itself (e.g. after eviction).
startSync().catch(logError);
