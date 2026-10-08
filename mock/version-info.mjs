import fs from 'node:fs';
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const changelog = JSON.parse(fs.readFileSync(new URL('../CHANGELOG.json', import.meta.url), 'utf8')).sort((a,b) => {
  const left = a.version.split('.').map(Number), right = b.version.split('.').map(Number);
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return right[index] - left[index];
  return 0;
});
const latestUrl = 'https://api.github.com/repos/weiAX95/admin/releases/latest';
let cached = null;
let checkedAt = 0;
let inFlight = null;

export function isNewerRelease(current, candidate) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(candidate || '');
  const base = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(current || '');
  if (!match || !base) return false;
  for (let i = 1; i <= 3; i++) {
    if (Number(match[i]) > Number(base[i])) return true;
    if (Number(match[i]) < Number(base[i])) return false;
  }
  return false;
}

export async function checkLatestRelease(fetcher = fetch, now = Date.now()) {
  if (checkedAt > 0 && now - checkedAt < 30 * 60 * 1000) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetcher(latestUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'agent-admin-update-check' }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) return null;
      const release = await response.json();
      if (release.draft || release.prerelease || !isNewerRelease(packageJson.version, release.tag_name) || typeof release.html_url !== 'string' || !/^https:\/\/github\.com\/weiAX95\/admin\/releases\//.test(release.html_url)) return null;
      return { version: release.tag_name, url: release.html_url };
    } catch { return null; }
  })();
  try { cached = await inFlight; checkedAt = now; return cached; }
  finally { inFlight = null; }
}

export function versionInfo() {
  return { currentVersion: packageJson.version, latest: cached, changelog };
}
export function resetVersionCheckForTests() { cached = null; checkedAt = 0; inFlight = null; }
