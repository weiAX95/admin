import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLatestRelease, isNewerRelease, resetVersionCheckForTests, versionInfo } from '../mock/version-info.mjs';

test('semantic version comparison ignores malformed and non-new releases', () => {
  assert.equal(isNewerRelease('0.1.0', 'v0.2.0'), true);
  assert.equal(isNewerRelease('0.1.0', 'v0.1.0'), false);
  assert.equal(isNewerRelease('1.9.0', 'v1.10.0'), true);
  assert.equal(isNewerRelease('0.1.0', 'v9.0.0-rc.1'), false);
});

test('release check caches the latest official release and stays quiet on 404, prerelease or offline', async () => {
  resetVersionCheckForTests();
  let calls = 0;
  const fetcher = async () => { calls++; return { ok: true, json: async () => ({ tag_name: 'v0.2.0', html_url: 'https://github.com/weiAX95/admin/releases/tag/v0.2.0', draft: false, prerelease: false }) }; };
  assert.equal((await checkLatestRelease(fetcher, 100000000)).version, 'v0.2.0');
  assert.equal((await checkLatestRelease(fetcher, 100000001)).version, 'v0.2.0');
  assert.equal(calls, 1);
  assert.equal(versionInfo().latest.version, 'v0.2.0');
  resetVersionCheckForTests();
  assert.equal(await checkLatestRelease(async () => ({ ok: false }), 100000000), null);
  resetVersionCheckForTests();
  assert.equal(await checkLatestRelease(async () => ({ ok: true, json: async () => ({ tag_name: 'v0.3.0', html_url: 'https://github.com/weiAX95/admin/releases/tag/v0.3.0', prerelease: true }) }), 100000000), null);
  resetVersionCheckForTests();
  assert.equal(await checkLatestRelease(async () => { throw new Error('offline'); }, 100000000), null);
  assert.ok(versionInfo().changelog.every(item => item.zh?.title && item.en?.title));
});
