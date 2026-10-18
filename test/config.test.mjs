import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('default credentials stay in this tool even when another connection exists', async t => {
  const config = await mkdtemp(join(tmpdir(), 'twitter-extractor-config-'));
  t.after(() => rm(config, { recursive: true, force: true }));
  await mkdir(join(config, 'her'));
  await writeFile(join(config, 'her/x-oauth.json'), '{}');
  const authFile = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { defaultAuthFile } from './src/config.mjs'; console.log(defaultAuthFile);"], {
    env: { ...process.env, XDG_CONFIG_HOME: config }, encoding: 'utf8',
  }).trim();
  assert.equal(authFile, join(config, 'twitter-extractor/x-oauth.json'));
});
