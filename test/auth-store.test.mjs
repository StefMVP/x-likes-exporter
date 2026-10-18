import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthStore } from '../src/auth-store.mjs';

test('missing credentials name the selected file and explain how to use an existing connection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'twitter-extractor-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authFile = join(directory, 'missing.json');
  await assert.rejects(createAuthStore(authFile).load(), error => {
    assert.ok(error.message.includes(authFile));
    assert.match(error.message, /--auth-file/);
    return true;
  });
});

test('invalid credential JSON does not expose tokens in the error', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'twitter-extractor-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const authFile = join(directory, 'invalid.json');
  await writeFile(authFile, '{"accessToken":"do-not-print",');
  await assert.rejects(createAuthStore(authFile).load(), error => {
    assert.match(error.message, /Invalid JSON/);
    assert.ok(error.message.includes(authFile));
    assert.doesNotMatch(error.message, /do-not-print/);
    return true;
  });
});
