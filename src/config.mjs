import { homedir } from 'node:os';
import { join } from 'node:path';

const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
export const defaultAuthFile = join(configHome, 'twitter-extractor', 'x-oauth.json');
export const defaultOutputDir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'twitter-extractor', 'x-likes');
export const defaultTimeZone = 'America/Chicago';
export const requiredScopes = ['tweet.read', 'users.read', 'like.read', 'offline.access'];

export function checkScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length !== requiredScopes.length ||
      requiredScopes.some(scope => !scopes.includes(scope))) {
    throw new Error('X authorization must contain exactly: ' + requiredScopes.join(', '));
  }
}
export const defaultArchiveDir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'twitter-extractor', 'x-likes-archive');
export const defaultDigestState = join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'twitter-extractor', 'digest-state.json');
