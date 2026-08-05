const PROJECT_ID = import.meta.env.VITE_BLINK_PROJECT_ID;
const BLINK_MODULES = ['ai', 'db', 'storage', 'data', 'realtime', 'notifications', 'analytics', 'connectors', 'rag'] as const;

function normalizeBlinkPath(rawPath: string, projectId: string): string {
  const trimmed = (rawPath || '').trim();
  if (!trimmed) throw new Error('No API path');

  const [pathPart, queryPart] = trimmed.split('?');
  let path = pathPart
    .replace(/^https?:\/\/[^/]+\/?/i, '') // strip accidental absolute URL
    .replace(/^\/+/, '')
    .replace(/^api\//, '');

  const parts = path.split('/').filter(Boolean);
  if (!parts.length) throw new Error('Invalid API path');

  const moduleName = parts[0];
  if (BLINK_MODULES.includes(moduleName as any) && parts[1] !== projectId) {
    parts.splice(1, 0, projectId); // enforce module/projectId/... shape
  }

  const normalizedPath = parts.join('/');
  return queryPart ? `${normalizedPath}?${queryPart}` : normalizedPath;
}

export function blinkAPI<T = any>(path: string, opts?: { method?: string; body?: any }): Promise<T> {
  const normalizedPath = normalizeBlinkPath(path, PROJECT_ID);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'BLINK_API', path: normalizedPath, method: opts?.method || 'GET', body: opts?.body },
      (res) => {
        if (chrome.runtime.lastError) { 
          reject(new Error(chrome.runtime.lastError.message)); 
          return; 
        }
        if (res?.error) { 
          reject(new Error(res.error)); 
          return; 
        }
        resolve(res?.data);
      }
    );
  });
}

export { PROJECT_ID };
