/**
 * Build-time configuration. Vite inlines these from .env when bundling the
 * service worker, so no credentials live in the repo or in chrome.storage.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const IS_PRODUCTION = false;

const noop = () => {};
export const log = IS_PRODUCTION ? noop : console.log.bind(console, '[sync]');
export const warn = IS_PRODUCTION ? noop : console.warn.bind(console, '[sync]');
export const logError = console.error.bind(console, '[sync]');
