import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuthStore, digestLikes, syncLikes } from '../src/index.mjs';

const now = new Date('2026-10-11T12:00:00Z');
const scopes = ['tweet.read', 'users.read', 'like.read', 'offline.access'];
const post = id => ({ id, text: `Post ${id}`, author_id: 'author', created_at: '2026-10-10T15:00:00Z',
  entities: { urls: [{ expanded_url: 'https://example.com/article' }] } });

async function setup(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'twitter-extractor-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const authFile = join(root, 'config/x-oauth.json');
  const outputDir = join(root, 'data');
  const store = createAuthStore(authFile);
  await store.save({ userId: 'user-one', accessToken: 'test-access', refreshToken: 'test-refresh',
    clientId: 'test-client', clientSecret: 'test-secret', scopes, expiresAt: now.getTime() + 3600_000, ...overrides });
  return { authFile, outputDir, now, store, latest: () => readFile(join(outputDir, 'latest.json'), 'utf8').then(JSON.parse) };
}

test('saves one page and keeps original links without reading the next page', async t => {
  const env = await setup(t);
  let calls = 0;
  const clientFactory = token => ({ readOnly: { v2: { userLikedTweets: async (id, options) => {
    calls++;
    assert.equal(token, 'test-access');
    assert.equal(id, 'user-one');
    assert.equal(options.max_results, 100);
    return { tweets: [post('1')], meta: { next_token: 'unused' }, fetchNext() { assert.fail('Extra page requested'); } };
  } } } });
  const result = await syncLikes({ ...env, clientFactory });
  assert.equal(calls, 1);
  assert.equal(result.status, 'synced');
  const saved = await env.latest();
  assert.equal(saved.nextPageAvailable, true);
  assert.equal(saved.firstRead, true);
  assert.equal(saved.newCount, null);
  assert.deepEqual(saved.posts[0].links, ['https://example.com/article']);
  assert.equal(saved.posts[0].url, 'https://x.com/i/status/1');
  assert.equal(await readFile(join(env.outputDir, '2026-10-11.json'), 'utf8'), JSON.stringify(saved, null, 2) + '\n');
  for (const file of [env.authFile, join(env.outputDir, 'latest.json')]) {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

test('a saved day skips token refresh and API reads', async t => {
  const env = await setup(t);
  await syncLikes({ ...env, clientFactory: () => ({ readOnly: { v2: { userLikedTweets: async () => ({ tweets: [post('1')] }) } } }) });
  await env.store.save({ ...await env.store.load(), expiresAt: 0 });
  const result = await syncLikes({ ...env, clientFactory: () => assert.fail('Unexpected network request') });
  assert.deepEqual(result, { status: 'already-synced', day: '2026-10-11', count: 1 });
});

test('refresh saves both replacement tokens before it reads likes', async t => {
  const env = await setup(t, { expiresAt: 0 });
  let reads = 0;
  await syncLikes({ ...env, clientFactory: input => typeof input === 'object' ? {
    async refreshOAuth2Token(token) {
      assert.equal(token, 'test-refresh');
      return { accessToken: 'replacement-access', refreshToken: 'replacement-refresh', scope: scopes, expiresIn: 7200 };
    },
  } : { readOnly: { v2: { async userLikedTweets() {
    reads++;
    assert.equal(input, 'replacement-access');
    assert.equal((await env.store.load()).refreshToken, 'replacement-refresh');
    return { tweets: [] };
  } } } } });
  assert.equal(reads, 1);
  assert.equal((await env.store.load()).accessToken, 'replacement-access');
});

test('a failed read preserves the previous snapshot', async t => {
  const env = await setup(t);
  await syncLikes({ ...env, clientFactory: () => ({ readOnly: { v2: { userLikedTweets: async () => ({ tweets: [post('1')] }) } } }) });
  const before = await env.latest();
  await env.store.save({ ...await env.store.load(), expiresAt: now.getTime() + 3 * 86400_000 });
  await assert.rejects(syncLikes({ ...env, now: new Date(now.getTime() + 86400_000),
    clientFactory: () => ({ readOnly: { v2: { userLikedTweets: async () => { throw new Error('API unavailable'); } } } }) }), /API unavailable/);
  assert.deepEqual(await env.latest(), before);
});

test('next day compares post IDs and uses the configured time zone', async t => {
  const env = await setup(t, { expiresAt: now.getTime() + 3 * 86400_000 });
  let posts = [post('1'), post('2')];
  const clientFactory = () => ({ readOnly: { v2: { userLikedTweets: async () => ({ tweets: posts }) } } });
  await syncLikes({ ...env, clientFactory });
  const midnightUtc = new Date('2026-10-12T01:00:00Z');
  assert.equal((await syncLikes({ ...env, now: midnightUtc, clientFactory })).status, 'already-synced');
  posts = [post('3'), post('2')];
  await syncLikes({ ...env, now: midnightUtc, timeZone: 'UTC', clientFactory });
  const saved = await env.latest();
  assert.equal(saved.day, '2026-10-12');
  assert.equal(saved.newCount, 1);
  assert.equal(saved.overlapWithPrevious, true);
});

test('switching accounts does not reuse the other account snapshot', async t => {
  const env = await setup(t);
  const clientFactory = () => ({ readOnly: { v2: { userLikedTweets: async () => ({ tweets: [post('1')] }) } } });
  await syncLikes({ ...env, clientFactory });
  await env.store.save({ ...await env.store.load(), userId: 'user-two' });
  assert.equal((await syncLikes({ ...env, clientFactory })).status, 'synced');
  const saved = await env.latest();
  assert.equal(saved.userId, 'user-two');
  assert.equal(saved.firstRead, true);
  assert.equal(saved.newCount, null);
});

test('write scopes fail before an API request', async t => {
  const env = await setup(t, { scopes: [...scopes, 'tweet.write'] });
  await assert.rejects(syncLikes({ ...env, clientFactory: () => assert.fail('Unexpected network request') }), /exactly/);
});

test('digest shows only unseen likes, skips archive IDs, and marks what it shows', async t => {
  const env = await setup(t);
  const posts = ['1', '2', '3', '4'].map(id => ({ ...post(id), text: `Line one\n\n  line two ${'x'.repeat(300)} https://t.co/abc` }));
  await syncLikes({ ...env, clientFactory: () => ({ readOnly: { v2: { userLikedTweets: async () => ({ tweets: posts }) } } }) });
  const archiveDir = join(env.outputDir, '../archive');
  await mkdir(archiveDir);
  await writeFile(join(archiveDir, 'likes.json'), JSON.stringify({ posts: [{ id: '4' }] }));
  const stateFile = join(env.outputDir, '../digest-state.json');
  const options = { outputDir: env.outputDir, archiveDir, stateFile, now };

  const peek = await digestLikes({ ...options, limit: 2, mark: false });
  assert.deepEqual({ ...peek.header, columns: undefined, urlBase: undefined }, { new: 3, shown: 2, total: 4, day: '2026-10-11',
    fetchedAt: now.toISOString(), stale: false, columns: undefined, urlBase: undefined });
  const [, first] = peek.text.split('\n');
  const [id, date, text, domains] = first.split('\t');
  assert.deepEqual([id, date, domains], ['1', '2026-10-10', 'example.com']);
  assert.ok(text.startsWith('Line one line two xxx') && text.length <= 200 && !text.includes('t.co'));
  await assert.rejects(stat(stateFile), { code: 'ENOENT' });

  assert.equal((await digestLikes({ ...options, limit: 2 })).text.split('\n').length, 3);
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
  const next = await digestLikes(options);
  assert.equal(next.header.new, 1);
  assert.equal(next.text.split('\n')[1].split('\t')[0], '3');
  assert.equal((await digestLikes(options)).header.new, 0);
  assert.equal((await digestLikes({ ...options, now: new Date(now.getTime() + 25 * 3600_000) })).header.stale, true);
});
