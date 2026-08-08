# Fix "Manifest file is missing or unreadable"

## What's happening

Chrome was pointed at `extension-src/`, which holds the source modules for the service worker only — no `manifest.json` lives there. The loadable extension is assembled into a `dist/` folder by the build script, and `dist/` is excluded from the downloaded code, so a fresh download has nothing to load.

Immediate fix on your machine, no code change needed:

```text
bun install
bun run build:extension
```

Then in `chrome://extensions` → Developer mode → Load unpacked → select the `dist` folder (not `extension-src`).

## What I'd change so this can't happen again

1. Add a packaging step to the build script that also writes a ready-to-load `public/linkedin-contact-saver.zip` from `dist/`, so the extension can be downloaded pre-built and just unzipped + loaded.
2. Add a `dist/README-LOAD-ME.txt`-style note and a clear "Load this folder" marker so the correct folder is obvious.
3. Rewrite the landing page (`index.html`) install steps to state explicitly: build, then load `dist/`, never `extension-src/`.
4. Update `README.md` with the same three-line quickstart.

## Technical notes

- `build-extension.js` already bundles `extension-src/background.js` and copies `manifest.json`, `content.js`, `sidepanel.*`, `styles.css`, `icons/` into `dist/`. Only the zip + docs steps are missing.
- Zipping runs via `nix run nixpkgs#zip` since `zip` isn't installed by default; the script will skip the zip gracefully if unavailable rather than failing the build.
- Supabase env vars are inlined at build time, so the zip must be regenerated after any credential change.
