/**
 * Connection defaults. The Project URL and Publishable (anon) key are public
 * values, so they can ship with the build; users can still override them from
 * Sync Settings, which stores them in chrome.storage.local.
 */
export const DEFAULT_SUPABASE_URL =
  import.meta.env?.VITE_SUPABASE_URL || 'https://wmmxdhjzpkuowqswscwv.supabase.co';

export const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtbXhkaGp6cGt1b3dxc3dzY3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NjMwNTAsImV4cCI6MjEwMTUzOTA1MH0.oUbXh1JIo1vjHGP6SRM_HKSxVUgL0reMwYcqQtVwHfY';

export const IS_PRODUCTION = false;

const noop = () => {};
export const log = IS_PRODUCTION ? noop : console.log.bind(console, '[sync]');
export const warn = IS_PRODUCTION ? noop : console.warn.bind(console, '[sync]');
export const logError = console.error.bind(console, '[sync]');
