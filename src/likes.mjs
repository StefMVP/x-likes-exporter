import { TwitterApi } from 'twitter-api-v2';
import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { createAuthStore } from './auth-store.mjs';
import { defaultOutputDir, defaultTimeZone, checkScopes } from './config.mjs';

export async function syncLikes({ authFile, outputDir = defaultOutputDir,
  timeZone = defaultTimeZone, now = new Date(), clientFactory = value => new TwitterApi(value) } = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const latestPath = join(outputDir, 'latest.json');
  let previous;
  try { previous = JSON.parse(await readFile(latestPath, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const store = createAuthStore(authFile);
  let auth = await store.load();
  checkScopes(auth.scopes);
  if (!auth.userId) throw new Error('X authorization has no user ID. Connect the account again.');
  if (previous?.userId !== auth.userId) previous = undefined;
  if (previous?.day === day && (previous.timeZone || defaultTimeZone) === timeZone) {
    return { status: 'already-synced', day, count: previous.posts.length };
  }

  let refreshed;
  if (auth.expiresAt < now.getTime() + 60_000) {
    const app = clientFactory({ clientId: auth.clientId, clientSecret: auth.clientSecret });
    try { refreshed = await app.refreshOAuth2Token(auth.refreshToken); } catch (error) {
      // Another process sharing this file may have replaced the refresh token. Retry once with the newest one.
      const latest = await store.load();
      if (latest.refreshToken === auth.refreshToken) {
        throw new Error(`X token refresh failed (${error?.code || error?.data?.error || 'error'}). The stored credentials were kept; reconnect with twitter-extractor authorize if this persists.`);
      }
      auth = latest;
      if (auth.expiresAt >= now.getTime() + 60_000) refreshed = null;
      else refreshed = await clientFactory({ clientId: auth.clientId, clientSecret: auth.clientSecret }).refreshOAuth2Token(auth.refreshToken);
    }
  }
  if (refreshed) {
    checkScopes(refreshed.scope);
    if (!refreshed.refreshToken) throw new Error('X refresh returned no refresh token. Connect the account again.');
    auth = { ...auth, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken,
      expiresAt: now.getTime() + refreshed.expiresIn * 1000, scopes: refreshed.scope };
    await store.save(auth);
  }

  // Request one page. Do not follow the next-page token.
  const page = await clientFactory(auth.accessToken).readOnly.v2.userLikedTweets(auth.userId, {
    max_results: 100,
    'tweet.fields': ['created_at', 'author_id', 'entities'],
  });
  const posts = page.tweets || [];
  const priorIds = new Set((previous?.posts || []).map(post => post.id));
  const receipt = {
    day, timeZone, userId: auth.userId, fetchedAt: now.toISOString(), pageLimit: 100,
    firstRead: !previous,
    newCount: previous ? posts.filter(post => !priorIds.has(post.id)).length : null,
    overlapWithPrevious: previous ? posts.some(post => priorIds.has(post.id)) : null,
    posts: posts.map(({ id, text, author_id, created_at, entities }) => ({
      id, text, authorId: author_id, createdAt: created_at,
      links: (entities?.urls || []).map(({ expanded_url }) => expanded_url).filter(Boolean),
      url: `https://x.com/i/status/${id}`,
    })),
    nextPageAvailable: Boolean(page.meta?.next_token),
  };
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  for (const target of [join(outputDir, `${day}.json`), latestPath]) {
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, target);
  }
  return { status: 'synced', day, count: receipt.posts.length, firstRead: receipt.firstRead,
    newCount: receipt.newCount, overlapWithPrevious: receipt.overlapWithPrevious,
    nextPageAvailable: receipt.nextPageAvailable, receipt: latestPath };
}
