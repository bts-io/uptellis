#!/usr/bin/env bash
# leak-check.sh: fail when any tracked (or untracked, not ignored) text file matches a private denylist.
#
# The denylist names what must never be published (company, people, hosts, account ids), so it is not in
# the repo. It is one case-insensitive extended regex per line; `#` lines and blank lines are ignored.
#   LEAK_DENYLIST        the list's content (for CI, from a secret), or else
#   LEAK_DENYLIST_FILE   a file holding it (default: $HOME/.config/uptellis/leak-denylist.txt)
# With neither, the check is skipped (exit 0).
#
# .leak-allow in the repo root is public: one exact string per line (case-insensitive, `#` comments), each
# removed from a line before the denylist runs, for names that are meant to be published.
#
# Prints `file:line` for every hit, never the matched text, and exits 1 on any hit. Needs GNU grep and sed.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

list_file=${LEAK_DENYLIST_FILE:-$HOME/.config/uptellis/leak-denylist.txt}
if [ -n "${LEAK_DENYLIST:-}" ]; then
  printf '%s\n' "$LEAK_DENYLIST" >"$tmp/raw"
elif [ -r "$list_file" ]; then
  cat "$list_file" >"$tmp/raw"
else
  echo "leak-check: no denylist configured, skipped"
  exit 0
fi
grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$tmp/raw" >"$tmp/patterns" || true
if [ ! -s "$tmp/patterns" ]; then
  echo "leak-check: no denylist configured, skipped"
  exit 0
fi

# One sed program deleting every allowed string, each escaped to match literally (case-insensitive).
: >"$tmp/allow.sed"
if [ -f .leak-allow ]; then
  while IFS= read -r entry || [ -n "$entry" ]; do
    entry=${entry%$'\r'}
    case $entry in '' | '#'*) continue ;; esac
    escaped=$(printf '%s' "$entry" | sed -e 's/[]\/$*.^[]/\\&/g')
    printf 's/%s//gI\n' "$escaped" >>"$tmp/allow.sed"
  done <.leak-allow
fi

hits=0
while IFS= read -r -d '' file; do
  [ -f "$file" ] || continue
  # Binary files (images, fonts) are skipped.
  grep -Iq . "$file" 2>/dev/null || continue
  lines=$(sed -f "$tmp/allow.sed" "$file" | grep -niE -f "$tmp/patterns" | cut -d: -f1 || true)
  for line in $lines; do
    echo "$file:$line"
    hits=$((hits + 1))
  done
done < <(git ls-files -z --cached --others --exclude-standard | sort -zu)

if [ "$hits" -gt 0 ]; then
  echo "leak-check: $hits line(s) match the denylist" >&2
  exit 1
fi
echo "leak-check: clean"
