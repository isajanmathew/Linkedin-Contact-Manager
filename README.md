# LinkedIn Connection Manager (Chrome Extension, Manifest V3)

Captures LinkedIn profile data into `chrome.storage.local` instantly (local-first), then syncs it to
your own Supabase database in the background over Realtime, with an offline outbox and
timestamp-based (`modifiedAt`) conflict resolution.

## Quickstart

```bash
npm install            # or: bun install
npm run build:extension
# then in Chrome: chrome://extensions → Developer mode → Load unpacked → select ./dist
```

## Load the right folder

Chrome must be pointed at **`dist/`** — the assembled extension containing `manifest.json`.

- `dist/` — build output. **This is what you load.**
- `extension-src/` — service-worker source modules. No manifest. Loading this gives
  “Manifest file is missing or unreadable”.
- project root — source files and tooling, not a loadable extension.

`dist/` is generated (git-ignored), so a fresh clone or download has no `dist/` until you run
`npm run build:extension`. The build also writes `dist/README-LOAD-ME.txt` as a reminder, and — when
a `zip` binary is available — packages `public/linkedin-contact-saver.zip` for sharing a pre-built copy.

Rebuild after any code change or Supabase credential change: the Supabase URL and publishable key are
inlined into the service worker at build time.

## First-run setup

1. Open a `linkedin.com/in/...` profile, then open the side panel.
2. Expand **Sync settings** and paste your Supabase Project URL and Publishable (anon) key.
3. Save contacts as normal. Writes land locally first; pending changes flush automatically when online.

## Usage

1. Navigate to any LinkedIn profile page.
2. Open the side panel and review the auto-extracted profile fields.
3. Add email, phone, tags, and notes.
4. Click **Save Contact** — stored locally, then synced.

## Architecture

```
manifest.json            # MV3 config (copied into dist/)
content.js               # LinkedIn extraction + floating button
sidepanel.html/.js       # Side panel UI; talks only to the service worker
styles.css               # Extension styling
icons/                   # Extension icons
extension-src/
  background.js          # Service worker entry (bundled → dist/background.js)
  config.js              # Supabase credentials, inlined at build time
  local-store.js         # chrome.storage.local contacts, outbox, tag usage
  supabase-client.js     # Supabase client + owner-key fingerprinting
  sync-engine.js         # Realtime subscribe, pull, outbox flush, conflicts
build-extension.js       # Bundles the worker, copies assets, packages the zip
```

Backend tables live in Supabase: `contacts` (row-level security scoped by owner key) and
`sync_events` (Realtime change markers only, no personal data).

## Troubleshooting

- **“Manifest file is missing or unreadable”** — you selected `extension-src/` or the project root.
  Run `npm run build:extension` and load `dist/`.
- **Side panel not opening** — confirm you are on `linkedin.com/in/username`, the extension is
  enabled, and reload the page.
- **Profile data missing** — LinkedIn layout changes; the extractor has fallback selectors, so refresh
  or renavigate to the profile.
- **Nothing syncing** — open Sync settings and check your Supabase connection URL/Key, pending count, and last synced
  time; click **Sync Now**. Offline changes stay queued until reachable.
- **Sync worked before but stopped after credential changes** — rebuild the extension and reload it in
  `chrome://extensions`.

## Security

- The device key never leaves `chrome.storage.local` except as a request header to Supabase.
- Row-level security scopes every row to a hashed owner key.
- The extension only runs on LinkedIn profile pages; all traffic is HTTPS.
