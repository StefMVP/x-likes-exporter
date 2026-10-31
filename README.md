# X likes exporter

Save your liked X posts to JSON files.

Each run saves up to 100 posts. It runs once per day and skips days already saved. It can miss likes between runs. It does not export your full history or download images and videos.

## Setup

You need Node.js 22 or later, Bash, and an X developer app with a client ID and client secret. X API access requires [credits](https://docs.x.com/x-api/getting-started/pricing).

Enable OAuth 2.0 in your X app and register this callback URL:

```text
http://127.0.0.1:8765/callback
```

Get the source and run:

```bash
git clone https://github.com/StefMVP/x-likes-exporter.git
cd x-likes-exporter
npm ci
npm run connect
npm run sync
```

Enter the client ID and client secret when asked. Open the printed link in a browser on the same computer and approve access.

## Saved files

Exports are in `~/.local/share/twitter-extractor/x-likes/`. Each file contains post text, dates, and links. `latest.json` holds the latest export; dated files keep earlier exports.

Credentials are in `~/.config/twitter-extractor/x-oauth.json`. Keep credentials and exports private.

## Export each day

On Linux with systemd:

```bash
npm run schedule
```

This runs each day at 07:00 in `America/Chicago`. Keep the project folder and Node.js installation at the same paths.

To copy each snapshot to a mounted backup drive, add the drive folder. The copy also removes files that no longer exist in the export folder:

```bash
npm run schedule -- --backup-dir /mnt/data/twitter-extractor-backup
```

The copy refuses to run when the drive is not mounted, so an unmounted drive cannot fill the system disk. Check the last copy in `~/.local/state/twitter-extractor/backup-status.json`.

To stop it:

```bash
systemctl --user disable --now twitter-extractor.timer
systemctl --user stop twitter-extractor.service
```

## Show saved posts

```bash
npm run digest
```

Print a short list from the latest export. This command remembers which posts it has shown and skips them next time.

## More options

```bash
node bin/twitter-extractor.mjs --help
```

Run checks with `npm test`.

License: [MIT](LICENSE).
