/**
 * Assembles the unpacked extension into dist/.
 *
 * The service worker is bundled from extension-src/ (it imports the Supabase
 * SDK, which MV3 cannot resolve at runtime); everything else is copied as-is so
 * the extension keeps its plain manifest/popup/content-script shape.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { build } from 'vite';
import { loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.join(__dirname, 'dist');

const filesToCopy = ['manifest.json', 'content.js', 'sidepanel.html', 'sidepanel.js', 'styles.css'];
const dirsToCopy = ['icons'];

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

const env = loadEnv('production', __dirname, 'VITE_');
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  console.warn('⚠ Supabase env vars missing — the built worker will not be able to sync.');
}

await build({
  configFile: false,
  root: __dirname,
  logLevel: 'warn',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || ''),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
      env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    ),
  },
  build: {
    outDir: distDir,
    copyPublicDir: false,
    emptyOutDir: false,
    target: 'chrome114',
    minify: false,
    rollupOptions: {
      input: path.join(__dirname, 'extension-src/background.js'),
      output: {
        entryFileNames: 'background.js',
        format: 'es',
        inlineDynamicImports: true,
      },
    },
  },
});
console.log('✓ Bundled background.js (service worker + Supabase client)');

filesToCopy.forEach((file) => {
  const srcPath = path.join(__dirname, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(distDir, file));
    console.log(`✓ Copied ${file}`);
  } else {
    console.warn(`⚠ Warning: ${file} not found`);
  }
});

dirsToCopy.forEach((dir) => {
  const srcPath = path.join(__dirname, dir);
  const destPath = path.join(distDir, dir);

  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠ Warning: ${dir}/ directory not found`);
    return;
  }

  fs.mkdirSync(destPath, { recursive: true });
  fs.readdirSync(srcPath).forEach((file) => {
    const srcFile = path.join(srcPath, file);
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, path.join(destPath, file));
    }
  });
  console.log(`✓ Copied ${dir}/ directory`);
});

// Marker so it's obvious which folder Chrome expects.
fs.writeFileSync(
  path.join(distDir, 'README-LOAD-ME.txt'),
  [
    'LOAD THIS FOLDER IN CHROME.',
    '',
    'This "dist" folder is the built, loadable extension — it contains manifest.json.',
    'Do NOT load "extension-src" (source modules only, no manifest) or the project root.',
    '',
    'Steps:',
    '  1. Open chrome://extensions',
    '  2. Enable "Developer mode" (top right)',
    '  3. Click "Load unpacked" and select THIS folder',
    '  4. Open a linkedin.com/in/... profile and open the side panel',
    '',
    'Rebuild after any code or Supabase credential change: npm run build:extension',
    '',
  ].join('\n'),
);
console.log('✓ Wrote README-LOAD-ME.txt');

// Package a ready-to-load zip next to the landing page.
const publicDir = path.join(__dirname, 'public');
const zipPath = path.join(publicDir, 'linkedin-contact-saver.zip');
fs.mkdirSync(publicDir, { recursive: true });
fs.rmSync(zipPath, { force: true });

// Use Python's built-in zipfile (guaranteed available in this environment)
const pyScript = `
import zipfile, os
dist_dir = os.path.abspath("${distDir.replace(/\\/g, '/')}")
zip_path = os.path.abspath("${zipPath.replace(/\\/g, '/')}")
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(dist_dir):
        for file in files:
            if file.endswith('.zip'):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, dist_dir)
            zipf.write(full_path, rel_path)
print("✓ Packaged extension zip:", zip_path)
`;

const zipResult = spawnSync('python3', ['-c', pyScript], { stdio: 'inherit' });
if (zipResult.status === 0 && fs.existsSync(zipPath)) {
  console.log(`✓ Successfully created public/linkedin-contact-saver.zip (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);
  // Copy to dist and dist-web
  fs.copyFileSync(zipPath, path.join(distDir, 'linkedin-contact-saver.zip'));
} else {
  console.warn('⚠ Could not create zip package.');
}

// Also sync extension into dist-web/extension and dist-web/ if dist-web exists
const distWebExtension = path.join(__dirname, 'dist-web', 'extension');
if (fs.existsSync(path.join(__dirname, 'dist-web'))) {
  fs.rmSync(distWebExtension, { recursive: true, force: true });
  fs.mkdirSync(distWebExtension, { recursive: true });
  fs.cpSync(distDir, distWebExtension, { recursive: true });
  if (fs.existsSync(zipPath)) {
    fs.copyFileSync(zipPath, path.join(__dirname, 'dist-web', 'linkedin-contact-saver.zip'));
  }
  console.log('✓ Synced extension copy to dist-web/extension/ and dist-web/linkedin-contact-saver.zip');
}

console.log('\n✅ Extension build complete! Load the "dist" folder in Chrome (not extension-src or dist-web).');
