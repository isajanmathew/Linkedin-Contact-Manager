LOAD THIS FOLDER IN CHROME.

This "dist" folder is the built, loadable extension — it contains manifest.json.
Do NOT load "extension-src" (source modules only, no manifest) or the project root.

Steps:
  1. Open chrome://extensions
  2. Enable "Developer mode" (top right)
  3. Click "Load unpacked" and select THIS folder
  4. Open a linkedin.com/in/... profile and open the side panel

Rebuild after any code or Supabase credential change: npm run build:extension
