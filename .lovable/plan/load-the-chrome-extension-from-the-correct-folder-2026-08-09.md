# Load the Chrome extension from the correct folder

## Confirmed cause

`dist-web/` is the hosted installation website output and does not contain `manifest.json`, so Chrome cannot load it as an extension. The actual extension build is `dist/`, which does contain the Manifest V3 file and all required assets.

## Resolution

1. On your computer, from the project root, run:
   ```text
   npm install
   npm run build:extension
   ```
   (`bun install` and `bun run build:extension` also work.)
2. In `chrome://extensions`, remove the failed `dist-web` entry if it remains.
3. Click **Load unpacked** and select:
   ```text
   Linkedin-Contact-Manager-main\dist
   ```
4. Alternatively, unzip `public/linkedin-contact-saver.zip` and select that unzipped folder.
5. Confirm Chrome shows **LinkedIn Contact Saver 2.0.0** without a manifest error.

## Important folder distinction

- `dist/` — load this in Chrome.
- `dist-web/` — website only; never load this as an extension.
- `extension-src/` — service-worker source only; never load this either.

No source-code change is required for this error.
