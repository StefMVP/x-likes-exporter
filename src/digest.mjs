import { dirname, join } from 'node:path';
import { mkdir, readFile, readdir, rename, writeFile, chmod } from 'node:fs/promises';
import { defaultArchiveDir, defaultDigestState, defaultOutputDir } from './config.mjs';

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

// Domains of outside links only; x.com and twitter.com links are other posts.
const domain = link => {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '');
    return ['x.com', 'twitter.com', 't.co'].includes(host) ? undefined : host;
  } catch { return undefined; }
};

// Print only likes this reader has not seen. Does not touch the network or credentials.
export async function digestLikes({ outputDir = defaultOutputDir, archiveDir = defaultArchiveDir,
  stateFile = defaultDigestState, limit = 40, sinceDays, mark = true, textChars = 200, now = new Date() } = {}) {
  const snapshot = await readJson(join(outputDir, 'latest.json'));
  if (!snapshot) throw new Error('No latest.json snapshot found. Run the likes command first.');
  const state = await readJson(stateFile);
  const seen = new Set(state?.ids || []);
  let archiveFiles = [];
  try { archiveFiles = (await readdir(archiveDir)).filter(name => name.endsWith('.json')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const name of archiveFiles) {
    for (const post of (await readJson(join(archiveDir, name)))?.posts || []) seen.add(post.id);
  }

  const cutoff = sinceDays === undefined ? undefined : now.getTime() - sinceDays * 86400_000;
  const fresh = snapshot.posts.filter(post => !seen.has(post.id) &&
    (cutoff === undefined || !(Date.parse(post.createdAt) < cutoff)));
  const shown = fresh.slice(0, limit);
  const header = { new: fresh.length, shown: shown.length, total: snapshot.posts.length, day: snapshot.day,
    fetchedAt: snapshot.fetchedAt, stale: now.getTime() - Date.parse(snapshot.fetchedAt) > 86400_000,
    columns: 'id date text domains', urlBase: 'https://x.com/i/status/<id>' };
  const clean = text => {
    const flat = (text || '').replace(/https?:\/\/t\.co\/\w+/g, '').replace(/\s+/g, ' ').trim();
    return flat.length > textChars ? `${flat.slice(0, textChars - 1)}…` : flat;
  };
  const lines = [JSON.stringify(header), ...shown.map(post => [post.id, (post.createdAt || '').slice(0, 10), clean(post.text),
    [...new Set((post.links || []).map(domain).filter(Boolean))].join(',')].join('\t'))];

  if (mark && shown.length) {
    const ids = [...(state?.ids || []), ...shown.map(post => post.id)];
    await mkdir(dirname(stateFile), { recursive: true, mode: 0o700 });
    const temp = `${stateFile}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ updatedAt: now.toISOString(), ids })}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, stateFile);
  }
  return { header, text: lines.join('\n') };
}
