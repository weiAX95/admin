/** Best-effort browser hint for grouping sessions, never an authentication factor. */
export async function deviceFingerprint(): Promise<string | undefined> {
  try {
    const storageKey = 'admin-browser-installation-id';
    let installationId: string;
    try {
      installationId = localStorage.getItem(storageKey) || crypto.randomUUID();
      localStorage.setItem(storageKey, installationId);
    } catch { installationId = crypto.randomUUID(); }
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 28;
    const context = canvas.getContext('2d');
    if (context) { context.font = '14px sans-serif'; context.fillText('Agent workspace', 2, 18); }
    const parts = [installationId, navigator.userAgent, `${screen.width}x${screen.height}`, Intl.DateTimeFormat().resolvedOptions().timeZone, context ? canvas.toDataURL() : ''];
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}
