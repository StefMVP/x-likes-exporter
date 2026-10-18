import { createServer } from 'node:http';
import { TwitterApi } from 'twitter-api-v2';
import { createAuthStore } from './auth-store.mjs';
import { requiredScopes, checkScopes, defaultAuthFile } from './config.mjs';
import { readFile } from 'node:fs/promises';

export async function authorize({ authFile, clientId = process.env.X_CLIENT_ID,
  clientSecret = process.env.X_CLIENT_SECRET, log = console.log } = {}) {
  if (!clientId || !clientSecret) {
    // Reuse the app credentials already stored with the connection, so no shell env is needed.
    try {
      const saved = JSON.parse(await readFile(authFile || defaultAuthFile, 'utf8'));
      clientId ||= saved.clientId; clientSecret ||= saved.clientSecret;
    } catch { /* no usable saved file */ }
  }
  if (!clientId || !clientSecret) throw new Error('Set X_CLIENT_ID and X_CLIENT_SECRET, or run npm run connect.');
  const redirectUri = 'http://127.0.0.1:8765/callback';
  const app = new TwitterApi({ clientId, clientSecret });
  const { url, state, codeVerifier } = app.generateOAuth2AuthLink(redirectUri, { scope: requiredScopes });
  const store = createAuthStore(authFile);
  return new Promise((resolve, reject) => {
    let processing = false;
    const server = createServer(async (request, response) => {
      const callback = new URL(request.url || '/', redirectUri);
      if (callback.pathname !== '/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      const code = callback.searchParams.get('code');
      if (!code || callback.searchParams.get('state') !== state || processing) {
        response.writeHead(400).end('Authorization was denied or the session did not match.');
        return;
      }
      processing = true;
      try {
        const tokens = await app.loginWithOAuth2({ code, codeVerifier, redirectUri });
        checkScopes(tokens.scope);
        if (!tokens.refreshToken) throw new Error('X returned no refresh token.');
        const { data: user } = await tokens.client.readOnly.v2.me();
        if (!user?.id) throw new Error('X did not return the account ID.');
        await store.save({ clientId, clientSecret, userId: user.id, username: user.username,
          accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000, scopes: tokens.scope });
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Your X account is connected. Return to the terminal.');
        log(`Connected X account @${user.username} with read-only scopes.`);
        resolve({ userId: user.id, username: user.username });
      } catch {
        response.writeHead(400).end('X authorization failed. Return to the terminal.');
        reject(new Error('X authorization failed. Check the app callback URL and account access.'));
      } finally {
        clearTimeout(timer);
        server.close();
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('X authorization timed out after five minutes.'));
    }, 5 * 60 * 1000);
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.listen(8765, '127.0.0.1', () => {
      log('Open this URL in a browser on this computer:');
      log(url);
      log('Waiting up to five minutes for the callback...');
    });
  });
}
