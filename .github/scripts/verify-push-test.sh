#!/usr/bin/env bash
# Negative tests for verify-push.sh. Not used in production paths.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(mktemp -d)"
PATH_DIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR" "$PATH_DIR"' EXIT

# Fake git/gh ahead of the real ones.
cat > "$PATH_DIR/git" << 'FAKE'
#!/usr/bin/env bash
set -euo pipefail
cmd="${1:-}"
shift || true
case "$cmd" in
  branch) echo "task/T-000"; exit 0 ;;
  fetch)
    echo "fatal: couldn't find remote ref refs/heads/task/T-000" >&2
    exit 128
    ;;
  *) echo "unexpected git $cmd $*" >&2; exit 90 ;;
esac
FAKE
chmod +x "$PATH_DIR/git"
cp "$PATH_DIR/git" "$PATH_DIR/gh"
# gh should not be called if fetch fails
cat > "$PATH_DIR/gh" << 'FAKE'
#!/usr/bin/env bash
echo "gh should not run when fetch fails" >&2
exit 90
FAKE
chmod +x "$PATH_DIR/gh"

echo "===== CASE: git fetch failure must fail Verify (no || true) ====="
set +e
PATH="$PATH_DIR:$PATH" bash "$HERE/verify-push.sh" task/T-000 >"$WORKDIR/out.txt" 2>"$WORKDIR/err.txt"
ec=$?
set -e
echo "exit=${ec}"
echo "----- stdout -----"
cat "$WORKDIR/out.txt"
echo "----- stderr -----"
cat "$WORKDIR/err.txt"
if [[ "$ec" -eq 0 ]]; then
  echo "ERROR: expected non-zero exit when git fetch fails"
  exit 1
fi
if ! grep -q "couldn't find remote ref\|fatal:" "$WORKDIR/err.txt" "$WORKDIR/out.txt"; then
  # git's message goes to stderr; script may not reprint it, but exit must be non-zero
  echo "fetch failed as expected (exit ${ec})"
fi
echo "CASE OK (fetch failure is not swallowed)"
