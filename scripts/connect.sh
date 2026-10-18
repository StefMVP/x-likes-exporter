#!/usr/bin/env bash
set -euo pipefail
EXTRACTOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo 'Register http://127.0.0.1:8765/callback as the OAuth 2.0 callback URL in your X app.'
read -r -p 'X app client ID: ' X_CLIENT_ID
read -r -s -p 'X app client secret: ' X_CLIENT_SECRET
echo
export X_CLIENT_ID X_CLIENT_SECRET
node "$EXTRACTOR_ROOT/bin/twitter-extractor.mjs" authorize "$@"
unset X_CLIENT_ID X_CLIENT_SECRET
