import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defaultAuthFile, checkScopes } from './config.mjs';

export function createAuthStore(authFile = defaultAuthFile) {
  return {
    async load() {
      let auth;
      try { auth = JSON.parse(await readFile(authFile, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') {
          throw new Error(`X credential file not found: ${authFile}. Use --auth-file with the connected account file, or run twitter-extractor authorize with this path.`);
        }
        // JSON parse errors can contain part of a credential. Do not print them.
        if (error instanceof SyntaxError) throw new Error(`Invalid JSON in X credential file: ${authFile}.`);
        throw error;
      }
      if (!auth || ['clientId', 'clientSecret', 'userId', 'accessToken', 'refreshToken'].some(
        key => typeof auth[key] !== 'string' || !auth[key].trim()) || !Number.isFinite(auth.expiresAt)) {
        throw new Error(`Incomplete X credential file: ${authFile}. Connect the account with twitter-extractor authorize using this path.`);
      }
      checkScopes(auth.scopes);
      return auth;
    },
    async save(value) {
      const directory = dirname(authFile);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = `${authFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await chmod(temp, 0o600);
      await rename(temp, authFile);
    },
  };
}
