import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const credentials = { clientId: 'test-client', clientSecret: 'test-secret', userId: 'test-user',
  accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: 0,
  scopes: ['tweet.read', 'users.read', 'like.read', 'offline.access'] };

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'twitter-extractor-timer-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  // The test must not change the user's services.
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TIMER_TEST_CALLS"\n', { mode: 0o755 });
  await writeFile(join(bin, 'systemd-analyze'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const config = join(directory, 'config with spaces');
  const data = join(directory, 'data');
  const calls = join(directory, 'systemctl-calls');
  const install = (args = []) => execFileSync(process.execPath, ['scripts/install-timer.mjs', ...args], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_CONFIG_HOME: config, XDG_DATA_HOME: data, TIMER_TEST_CALLS: calls },
    stdio: 'pipe',
  });
  return { directory, config, data, calls, install };
}

test('timer uses XDG paths and applies startup and failure recovery to an active timer', { skip: process.platform !== 'linux' }, async t => {
  const { config, data, calls, install } = await setup(t);
  await mkdir(join(config, 'twitter-extractor'), { recursive: true });
  await writeFile(join(config, 'twitter-extractor/x-oauth.json'), JSON.stringify(credentials));
  install(['--at', '08:30', '--time-zone', 'Europe/London']);
  const service = await readFile(join(config, 'systemd/user/twitter-extractor.service'), 'utf8');
  const timer = await readFile(join(config, 'systemd/user/twitter-extractor.timer'), 'utf8');
  assert.ok(service.includes(`"${join(config, 'twitter-extractor/x-oauth.json')}"`));
  assert.ok(service.includes(`"${join(data, 'twitter-extractor/x-likes')}"`));
  assert.match(service, /"--time-zone" "Europe\/London"/);
  assert.match(service, /StartLimitIntervalSec=0/);
  assert.match(service, /Restart=on-failure/);
  assert.match(service, /RestartSec=5min/);
  assert.match(service, /TimeoutStartSec=90/);
  assert.match(timer, /OnCalendar=\*-\*-\* 08:30:00 Europe\/London/);
  assert.match(timer, /OnActiveSec=2min/);
  assert.match(timer, /Persistent=true/);
  assert.match(await readFile(calls, 'utf8'), /--user restart twitter-extractor.timer/);
});

test('a custom connection works without a default auth file and keeps its absolute path', { skip: process.platform !== 'linux' }, async t => {
  const { directory, config, install } = await setup(t);
  const authFile = join(directory, 'shared account.json');
  const outputDir = join(directory, 'feed data');
  await writeFile(authFile, JSON.stringify(credentials));
  install(['--auth-file', authFile, '--output-dir', outputDir]);
  const service = await readFile(join(config, 'systemd/user/twitter-extractor.service'), 'utf8');
  assert.ok(service.includes(`"--auth-file" "${authFile}"`));
  assert.ok(service.includes(`"--output-dir" "${outputDir}"`));
});

test('missing or invalid credentials leave an existing schedule intact', { skip: process.platform !== 'linux' }, async t => {
  const { directory, config, calls, install } = await setup(t);
  const unitDir = join(config, 'systemd/user');
  await mkdir(unitDir, { recursive: true });
  const serviceFile = join(unitDir, 'twitter-extractor.service');
  const timerFile = join(unitDir, 'twitter-extractor.timer');
  await writeFile(serviceFile, 'existing service');
  await writeFile(timerFile, 'existing timer');
  const authFile = join(directory, 'account.json');
  for (const contents of [undefined, '{"secret":"do-not-print",', JSON.stringify({ userId: 'user' }),
    JSON.stringify({ ...credentials, scopes: [...credentials.scopes, 'tweet.write'] })]) {
    if (contents !== undefined) await writeFile(authFile, contents);
    assert.throws(() => install(['--auth-file', authFile]), error => {
      const message = error.stderr.toString();
      assert.doesNotMatch(message, /do-not-print/);
      return /credential file|exactly/.test(message);
    });
    assert.equal(await readFile(serviceFile, 'utf8'), 'existing service');
    assert.equal(await readFile(timerFile, 'utf8'), 'existing timer');
    await assert.rejects(readFile(calls), { code: 'ENOENT' });
  }
});
