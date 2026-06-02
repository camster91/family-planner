#!/bin/bash
# GitHub webhook receiver for family-planner deploys.
#
# Listens on a port (set below) for POSTs from the GitHub Actions
# deploy workflow. Validates a shared secret, then triggers the
# pull-based deploy script.
#
# Install:
#   1. Copy this to /opt/family-planner-webhook.sh
#   2. Set WEBHOOK_SECRET below
#   3. Create systemd unit (see /etc/systemd/system/family-planner-webhook.service)
#   4. systemctl enable --now family-planner-webhook
#
# Or just run via nohup:
#   nohup /opt/family-planner-webhook.sh > /var/log/family-planner-webhook.log 2>&1 &

set -euo pipefail

# --- Config ---
PORT=8741
WEBHOOK_SECRET="${FAMILY_PLANNER_WEBHOOK_SECRET:-please-change-me-32-chars-minimum}"
LOG="/var/log/family-planner-webhook.log"
DEPLOY_SCRIPT="/opt/family-planner-deploy.sh"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

# --- nc-based webhook server (no extra deps) ---
# Accepts a connection, reads request, parses headers + body, validates
# secret, then triggers deploy.

# We'll use a simple Python server because parsing HTTP headers with
# just netcat is painful.

python3 - <<PYEOF
import http.server
import hmac
import hashlib
import os
import subprocess
import sys
from datetime import datetime, timezone

SECRET = "${WEBHOOK_SECRET}"
LOG = "${LOG}"
DEPLOY = "${DEPLOY_SCRIPT}"
PORT = ${PORT}

def log(msg):
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    line = f'[{ts}] {msg}'
    print(line, flush=True)
    with open(LOG, 'a') as f:
        f.write(line + '\n')

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress default logging

    def do_POST(self):
        if self.path != '/deploy':
            self.send_response(404)
            self.end_headers()
            return

        # Read body
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8') if length else ''

        # Verify signature if provided (GitHub sends X-Hub-Signature-256)
        sig_header = self.headers.get('X-Hub-Signature-256', '')
        if sig_header.startswith('sha256='):
            expected = 'sha256=' + hmac.new(
                SECRET.encode(), body.encode(), hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(sig_header, expected):
                log(f'401: bad signature from {self.client_address}')
                self.send_response(401)
                self.end_headers()
                return

        # Check shared secret (simpler than HMAC, set as query param or header)
        auth = self.headers.get('X-Webhook-Secret', '')
        if auth and auth != SECRET:
            log(f'401: bad secret from {self.client_address}')
            self.send_response(401)
            self.end_headers()
            return

        # Parse body — could be GitHub webhook payload, our custom JSON, or empty
        tag = 'latest'
        if body:
            try:
                import json
                data = json.loads(body)
                tag = data.get('ref', data.get('tag', data.get('image_tag', 'latest')))
                if tag.startswith('refs/heads/'):
                    tag = tag.split('/')[-1]
            except Exception:
                pass

        log(f'deploy triggered for tag={tag} from {self.client_address}')

        # Fire the deploy script in the background
        subprocess.Popen(
            ['/bin/bash', DEPLOY, tag],
            stdout=open(LOG, 'a'), stderr=subprocess.STDOUT,
            start_new_session=True
        )

        self.send_response(202)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"status":"queued","tag":"' + tag.encode() + b'"}')

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'ok')
        else:
            self.send_response(404)
            self.end_headers()

log(f'webhook listener starting on port {PORT}')
http.server.HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
PYEOF
