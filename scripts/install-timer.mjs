import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultAuthFile, defaultOutputDir } from '../src/config.mjs';
import { createAuthStore } from '../src/auth-store.mjs';

const { values } = parseArgs({ options: {
  'time-zone': { type: 'string', default: 'America/Chicago' },
  at: { type: 'string', default: '07:00' },
  'auth-file': { type: 'string' },
  'output-dir': { type: 'string' },
  'backup-dir': { type: 'string' },
} });
new Intl.DateTimeFormat('en-US', { timeZone: values['time-zone'] });
if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(values.at)) throw new Error('Use --at HH:MM in 24-hour time.');
const authFile = values['auth-file'] ? resolve(values['auth-file']) : defaultAuthFile;
const outputDir = values['output-dir'] ? resolve(values['output-dir']) : defaultOutputDir;
const backupDir = values['backup-dir'] ? resolve(values['backup-dir']) : null;
if (backupDir === outputDir) throw new Error('Use a backup folder outside --output-dir.');
// Check the selected credentials before replacing a working schedule. An expired
// access token is valid here: the next run will use the stored refresh token.
await createAuthStore(authFile).load();
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd/user');
const quote = value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$') + '"';
const command = [process.execPath, join(root, 'bin/twitter-extractor.mjs'), 'likes',
  '--auth-file', authFile, '--output-dir', outputDir,
  '--time-zone', values['time-zone']].map(quote).join(' ');
const backup = backupDir
  ? `ExecStartPost=${[join(root, 'scripts/backup.sh'), outputDir, backupDir].map(quote).join(' ')}\n`
  : '';
// Check calendar syntax before writing or enabling any unit.
const calendar = `*-*-* ${values.at}:00 ${values['time-zone']}`;
execFileSync('systemd-analyze', ['calendar', calendar], { stdio: 'pipe' });
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'twitter-extractor.service'), `[Unit]
Description=Save X liked posts
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=${command}
${backup}UMask=0077
TimeoutStartSec=90
Restart=on-failure
RestartSec=5min
`);
await writeFile(join(directory, 'twitter-extractor.timer'), `[Unit]
Description=Read X likes each day

[Timer]
OnCalendar=${calendar}
OnActiveSec=2min
Persistent=true

[Install]
WantedBy=timers.target
`);
execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('systemctl', ['--user', 'enable', '--now', 'twitter-extractor.timer'], { stdio: 'inherit' });
// Apply the startup trigger when updating a timer that is already active.
execFileSync('systemctl', ['--user', 'restart', 'twitter-extractor.timer'], { stdio: 'inherit' });
console.log(`Daily X read enabled at ${values.at} ${values['time-zone']}, with a startup check and retries every five minutes after failure.`);
console.log(`Credentials: ${authFile}\nSnapshots: ${outputDir}`);
if (backupDir) console.log(`Backup: ${backupDir}`);
