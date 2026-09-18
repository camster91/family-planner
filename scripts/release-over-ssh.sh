#!/usr/bin/env bash
#
# Release family-planner to the VPS over SSH.
#
# This is the escape hatch for when GitHub Actions cannot run — which, for this
# account, has been the normal state. It does what
# .github/workflows/release.yml does, but driven from a workstation instead of
# from a workflow job. The deploy itself is still .github/scripts/deploy-vps.sh,
# executed on the VPS; this script only gets the source there and starts it, so
# there is exactly one implementation of "swap the production container".
#
#   ./scripts/release-over-ssh.sh              # release origin/master
#   ./scripts/release-over-ssh.sh <full-sha>   # release a specific commit
#   ./scripts/release-over-ssh.sh --wait       # release, then follow the log
#
# Env: FP_SSH_HOST — ssh host or alias of the VPS (default: coolify)
#
# Why the source travels as a tarball and not a git clone: the VPS holds no
# credentials for this private repository.
#
# Why `git archive` instead of tarring the working tree: with core.autocrlf=true
# the working tree is CRLF while the blobs are LF, so a plain tar ships CRLF and
# the deploy dies on its own line 25 with `set: pipefail: invalid option name` —
# a dash error, from a file whose sha256 still matches the local copy, because
# both sides are CRLF.
#
set -euo pipefail

REMOTE="${FP_SSH_HOST:-coolify}"
WAIT=0
SHA=""

for arg in "$@"; do
  case "$arg" in
    --wait) WAIT=1 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) SHA="$arg" ;;
  esac
done

if [ -z "$SHA" ]; then
  git fetch --quiet origin
  SHA="$(git rev-parse origin/master)"
fi
if ! printf '%s' "$SHA" | grep -qE '^[0-9a-f]{40}$'; then
  echo "expected a full 40-character sha, got: $SHA" >&2
  exit 2
fi

TAG="${SHA:0:7}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "releasing ${TAG} from $(git rev-parse --show-toplevel)"
git -c core.autocrlf=false archive --format=tar.gz -o "$TMP/tree.tar.gz" "$SHA"
SIZE="$(wc -c < "$TMP/tree.tar.gz" | tr -d ' ')"
SUM="$(sha256sum "$TMP/tree.tar.gz" | cut -d' ' -f1)"
echo "tree: ${SIZE} bytes, sha256 ${SUM}"

# scp is unavailable on this host (no sftp subsystem — it closes the connection),
# so the archive goes over the same ssh channel. MSYS2_ARG_CONV_EXCL stops Git
# Bash rewriting remote paths into C:/Program Files/Git/... equivalents.
echo "uploading to ${REMOTE}..."
cat "$TMP/tree.tar.gz" | MSYS2_ARG_CONV_EXCL='*' ssh -o BatchMode=yes "$REMOTE" 'cat > fp-release.tar.gz'

echo "extracting and starting the deploy..."
ssh -o BatchMode=yes "$REMOTE" "SHA='$SHA' SUM='$SUM' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
SRC="$HOME/fp-release.tar.gz"
[ -s "$SRC" ] || { echo "::error::uploaded archive is empty" >&2; exit 1; }

ACTUAL="$(sha256sum "$SRC" | cut -d' ' -f1)"
if [ "$ACTUAL" != "$SUM" ]; then
  echo "::error::checksum mismatch: got $ACTUAL, expected $SUM" >&2
  rm -f "$SRC"
  exit 1
fi
echo "checksum ok"

TAG="${SHA:0:7}"
DEST="/opt/family-planner/releases/$TAG"
mkdir -p "$DEST"
tar -xzf "$SRC" -C "$DEST"
rm -f "$SRC"

# A CRLF tree cannot run: the deploy script would die on its own first line.
# `grep -c` exits 1 on zero matches, hence the `|| true`.
CR="$(od -An -tx1 "$DEST/.github/scripts/deploy-vps.sh" | tr ' ' '\n' | grep -c '^0d$' || true)"
if [ "$CR" != "0" ]; then
  echo "::error::deploy-vps.sh has $CR CR bytes; refusing to release a CRLF tree" >&2
  exit 1
fi
echo "extracted $TAG to $DEST (LF clean)"

cd "$DEST"
LOG="/var/log/fp-deploy-$TAG.log"
install -m 600 /dev/null "$LOG"
setsid nohup bash .github/scripts/deploy-vps.sh "$SHA" > "$LOG" 2>&1 < /dev/null &
echo "deploy started (pid $!)"
echo "log: $LOG"
REMOTE_SCRIPT

LOG="/var/log/fp-deploy-${TAG}.log"

if [ "$WAIT" = "1" ]; then
  echo "waiting for the deploy to finish (a cold build takes 5-10 min)..."
  for _ in $(seq 1 150); do
    # Match the deploy script's own terminal lines. Deliberately NOT a
    # `pgrep -f deploy-vps.sh`: the shell running that pgrep carries the string
    # in its own argv, matches itself, and so never reports "finished".
    if ssh -o BatchMode=yes "$REMOTE" "tail -n 300 '$LOG' 2>/dev/null | grep -qE '^(Released |::error::)'"; then
      break
    fi
    sleep 5
  done
  ssh -o BatchMode=yes "$REMOTE" "tail -n 25 '$LOG'"
fi

echo
echo "follow:  ssh $REMOTE 'tail -f $LOG'"
echo "verify:  curl -s -o /dev/null -w '%{http_code}\\n' https://family.ashbi.ca/api/health/live   # 200 means live"
