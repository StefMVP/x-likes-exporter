import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const credentials = { clientId: 'test-client', clientSecret: 'test-secret', userId: 'test-user',
  accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: 0,
  scopes: ['tweet.read', 'users.read', 'like.read', 'offline.access'] };

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'twitter-extractor-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(join(bin, 'systemd-analyze'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const config = join(directory, 'config');
  await mkdir(join(config, 'twitter-extractor'), { recursive: true });
  await writeFile(join(config, 'twitter-extractor/x-oauth.json'), JSON.stringify(credentials));
  return { directory, config };
}

function backup(env, source, destination) {
  return run('bash', ['scripts/backup.sh', source, destination], { env: { ...process.env, ...env } });
}

test('a backup folder adds the copy step to the daily unit', { skip: process.platform !== 'linux' }, async t => {
  const { directory, config } = await setup(t);
  const status = join(directory, 'status.json');
  execFileSync(process.execPath, ['scripts/install-timer.mjs', '--backup-dir', join(directory, 'drive copy')], {
    env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`, XDG_CONFIG_HOME: config, BACKUP_STATUS_FILE: status },
    stdio: 'pipe',
  });
  const service = await readFile(join(config, 'systemd/user/twitter-extractor.service'), 'utf8');
  assert.match(service, /^ExecStartPost=.*scripts\/backup\.sh".*drive copy"$/m);
});

test('the daily unit has no copy step without a backup folder', { skip: process.platform !== 'linux' }, async t => {
  const { directory, config } = await setup(t);
  execFileSync(process.execPath, ['scripts/install-timer.mjs'], {
    env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`, XDG_CONFIG_HOME: config },
    stdio: 'pipe',
  });
  const service = await readFile(join(config, 'systemd/user/twitter-extractor.service'), 'utf8');
  assert.doesNotMatch(service, /ExecStartPost/);
});

test('a mounted drive copy matches the source and records a receipt', { skip: process.platform !== 'linux' }, async t => {
  const { directory } = await setup(t);
  const onOtherFilesystem = '/mnt/data';
  let device;
  try {
    device = (await run('stat', ['-c', '%d', onOtherFilesystem])).stdout.trim();
  } catch {
    t.skip('no backup drive is mounted at /mnt/data');
    return;
  }
  if (device === (await run('stat', ['-c', '%d', tmpdir()])).stdout.trim()) {
    t.skip('the backup drive is not mounted');
    return;
  }
  const source = join(directory, 'source');
  const destination = join(onOtherFilesystem, `twitter-extractor-test-${process.pid}`);
  t.after(() => rm(destination, { recursive: true, force: true }));
  await mkdir(join(source, 'x-likes'), { recursive: true });
  await writeFile(join(source, 'x-likes/latest.json'), '{"posts":1}');
  await writeFile(join(source, 'x-likes/2026-10-30.json'), '{"posts":1}');
  const status = join(directory, 'status.json');
  await backup({ BACKUP_STATUS_FILE: status }, source, destination);
  assert.equal(await readFile(join(destination, 'x-likes/latest.json'), 'utf8'), '{"posts":1}');
  const receipt = JSON.parse(await readFile(status, 'utf8'));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.files, 2);
  // A stale file from an earlier copy must not stay behind.
  await writeFile(join(destination, 'x-likes/stale.json'), '{}');
  await backup({ BACKUP_STATUS_FILE: status }, source, destination);
  await assert.rejects(readFile(join(destination, 'x-likes/stale.json')));
});

test('an unmounted drive is refused instead of filling the system disk', { skip: process.platform !== 'linux' }, async t => {
  const { directory } = await setup(t);
  const source = join(directory, 'source');
  const destination = join(directory, 'not-a-drive');
  await mkdir(source, { recursive: true });
  const status = join(directory, 'status.json');
  await assert.rejects(backup({ BACKUP_STATUS_FILE: status }, source, destination), error => {
    assert.equal(error.code, 78);
    assert.match(error.stderr, /Mount the backup drive first/);
    return true;
  });
  assert.equal(JSON.parse(await readFile(status, 'utf8')).ok, false);
});
