#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { authorize, syncLikes, digestLikes } from '../src/index.mjs';
import { defaultAuthFile, defaultOutputDir, defaultTimeZone, defaultArchiveDir, defaultDigestState } from '../src/config.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' },
    'auth-file': { type: 'string' },
    'output-dir': { type: 'string' },
    'time-zone': { type: 'string' },
    limit: { type: 'string' },
    'since-days': { type: 'string' },
    'no-mark': { type: 'boolean' },
    'state-file': { type: 'string' },
    'archive-dir': { type: 'string' },
  } });
  if (values.help || !positionals.length) {
    console.log(`Usage: twitter-extractor <authorize|likes|digest> [options]

authorize  Connect your X account with OAuth 2.0 PKCE.
likes      Read one page of up to 100 likes; skip a saved day.
digest     Print only saved likes not seen before (no network); marks them seen.

--auth-file FILE  OAuth token file (default: ${defaultAuthFile})
--output-dir DIR  JSON output directory (default: ${defaultOutputDir})
--time-zone ZONE  Time zone for the saved day (default: ${defaultTimeZone})

digest options:
--limit N         Show at most N new likes (default: 40)
--since-days N    Only posts created in the last N days
--no-mark         Do not record the shown likes as seen
--state-file FILE Seen-IDs file (default: ${defaultDigestState})
--archive-dir DIR Historical archives to skip (default: ${defaultArchiveDir})

Set X_CLIENT_ID and X_CLIENT_SECRET before authorization.
Callback URL: http://127.0.0.1:8765/callback`);
  } else {
    if (positionals.length !== 1 || !['authorize', 'likes', 'digest'].includes(positionals[0])) {
      throw new Error('Use authorize, likes, or digest. Run with --help for options.');
    }
    const options = {
      authFile: values['auth-file'] ? resolve(values['auth-file']) : undefined,
      outputDir: values['output-dir'] ? resolve(values['output-dir']) : undefined,
      timeZone: values['time-zone'],
    };
    if (positionals[0] === 'digest') {
      const number = (name, min) => {
        if (values[name] === undefined) return undefined;
        const value = Number(values[name]);
        if (!Number.isFinite(value) || value < min) throw new Error(`Use --${name} with a number of at least ${min}.`);
        return value;
      };
      console.log((await digestLikes({
        outputDir: options.outputDir, archiveDir: values['archive-dir'] ? resolve(values['archive-dir']) : undefined,
        stateFile: values['state-file'] ? resolve(values['state-file']) : undefined,
        limit: number('limit', 1), sinceDays: number('since-days', 0), mark: !values['no-mark'],
      })).text);
    } else if (positionals[0] === 'authorize') await authorize(options);
    else console.log(JSON.stringify(await syncLikes(options)));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
