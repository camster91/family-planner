#!/bin/bash
# GitHub webhook receiver for family-planner deploys.
#
# Listens for POSTs and triggers the pull-based deploy script, but ONLY after
# authenticating the request. A deploy trigger is a privileged action: if this
# endpoint accepts unauthenticated calls, anyone who can reach the port can
# deploy to production.
#
# Install:
#   1. Copy this to /opt/family-planner-webhook.sh
#   2. Set FAMILY_PLANNER_WEBHOOK_SECRET in the systemd unit (NOT in this file)
#   3. Create the systemd unit (see scripts/family-planner-webhook.service)
#   4. systemctl enable --now family-planner-webhook
#
# Authentication (both required — this is a deliberate change):
#   * X-Hub-Signature-256 — HMAC-SHA256 of the raw body, constant-time compared.
#     Required on every request. GitHub sends this on webhook deliveries.
#   * X-Webhook-Secret — a shared secret, constant-time compared.
#
# History: the previous version checked the signature ONLY if the header was
# present, and the secret ONLY if it was non-empty, so a POST with neither header
# was accepted and deployed. It also defaulted the secret to a placeholder and
# shipped a unit that ran as root on 0.0.0.0. See #182.

set -euo pipefail

# --- Config ---
PORT="${FAMILY_PLANNER_WEBHOOK_PORT:-8741}"
# Bind to loopback by default. Exposing a deploy trigger on 0.0.0.0 puts it on
# every interface; put a real reverse proxy in front if it must be reachable.
BIND_ADDR="${FAMILY_PLANNER_WEBHOOK_BIND:-127.0.0.1}"
LOG="${FAMILY_PLANNER_WEBHOOK_LOG:-/var/log/family-planner-webhook.log}"
DEPLOY_SCRIPT="${FAMILY_PLANNER_DEPLOY_SCRIPT:-/opt/family-planner-deploy.sh}"

# --- Fail closed on a missing or placeholder secret, before listening ---
# A placeholder secret is worse than none: it looks configured while being
# publicly known. Refuse to start rather than accept unauthenticated deploys.
WEBHOOK_SECRET="${FAMILY_PLANNER_WEBHOOK_SECRET:-}"

if [ -z "$WEBHOOK_SECRET" ]; then
  echo "FATAL: FAMILY_PLANNER_WEBHOOK_SECRET is not set. Refusing to start: an unauthenticated deploy endpoint must not run." >&2
  exit 1
fi

if [ ${#WEBHOOK_SECRET} -lt 32 ]; then
  echo "FATAL: FAMILY_PLANNER_WEBHOOK_SECRET is shorter than 32 characters. Refusing to start." >&2
  exit 1
fi

case "$WEBHOOK_SECRET" in
  please-change-me*|changeme*|change-me*|secret*|password*|example*|test*)
    echo "FATAL: FAMILY_PLANNER_WEBHOOK_SECRET still looks like a placeholder. Refusing to start." >&2
    exit 1
    ;;
esac

if [ ! -x "$DEPLOY_SCRIPT" ] && [ ! -f "$DEPLOY_SCRIPT" ]; then
  echo "WARNING: deploy script $DEPLOY_SCRIPT not found; deploys will fail." >&2
fi

export WEBHOOK_SECRET LOG DEPLOY_SCRIPT PORT BIND_ADDR

python3 - <<'PYEOF'
import http.server
import hmac
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

SECRET = os.environ["WEBHOOK_SECRET"].encode()
LOG = os.environ["LOG"]
DEPLOY = os.environ["DEPLOY_SCRIPT"]
PORT = int(os.environ["PORT"])
BIND_ADDR = os.environ["BIND_ADDR"]

# Only these methods may trigger work. A deploy is POST-only.
MAX_BODY = 1 * 1024 * 1024  # 1 MiB

def log(msg):
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    try:
        with open(LOG, 'a') as f:
            f.write(line + '\n')
    except OSError:
        pass  # logging must never block an auth decision

def ct_eq(a: str, b: str) -> bool:
    """Constant-time string compare that tolerates unequal lengths."""
    return hmac.compare_digest(a.encode(), b.encode())

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default logging

    def _deny(self, code, reason):
        log(f'{code}: {reason} from {self.client_address}')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": reason}).encode())

    def do_POST(self):
        if self.path != '/deploy':
            self.send_response(404)
            self.end_headers()
            return

        # Bound the body before reading it.
        try:
            length = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self._deny(400, 'bad content-length')
            return
        if length > MAX_BODY:
            self._deny(413, 'body too large')
            return

        body = self.rfile.read(length).decode('utf-8', errors='replace') if length else ''

        # --- Authentication: BOTH checks are mandatory ---
        # Previously each was skipped when absent, which is what made this an
        # unauthenticated deploy endpoint.
        sig_header = self.headers.get('X-Hub-Signature-256', '')
        if not sig_header.startswith('sha256='):
            self._deny(401, 'missing or malformed X-Hub-Signature-256')
            return

        expected = 'sha256=' + hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig_header, expected):
            self._deny(401, 'bad signature')
            return

        # Second factor: the shared secret, also required. Absent means deny.
        provided_secret = self.headers.get('X-Webhook-Secret', '')
        if not provided_secret:
            self._deny(401, 'missing X-Webhook-Secret')
            return
        if not ct_eq(provided_secret, SECRET.decode()):
            self._deny(401, 'bad secret')
            return

        # --- Authenticated. Parse the tag and deploy. ---
        tag = 'latest'
        if body:
            try:
                data = json.loads(body)
                tag = data.get('ref', data.get('tag', data.get('image_tag', 'latest')))
                if isinstance(tag, str) and tag.startswith('refs/heads/'):
                    tag = tag.split('/')[-1]
            except Exception:
                pass

        # Keep the tag to a safe character set: it is passed to the deploy script
        # as an argument, and a crafted value must not become shell syntax.
        if not isinstance(tag, str) or len(tag) > 100:
            self._deny(400, 'invalid tag')
            return
        if not all(c.isalnum() or c in '._-/' for c in tag):
            self._deny(400, 'invalid tag')
            return

        log(f'deploy triggered for tag={tag} from {self.client_address}')

        subprocess.Popen(
            ['/bin/bash', DEPLOY, tag],
            stdout=open(LOG, 'a'), stderr=subprocess.STDOUT,
            start_new_session=True
        )

        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"status": "queued", "tag": tag}).encode())

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()

log(f'webhook listener starting on {BIND_ADDR}:{PORT}')
http.server.HTTPServer((BIND_ADDR, PORT), Handler).serve_forever()
PYEOF
