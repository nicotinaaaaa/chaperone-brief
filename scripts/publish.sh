#!/usr/bin/env bash
set -euo pipefail

# Non-interactive ingest -> build -> commit -> push wrapper — what a
# scheduled task runs. Every stage either succeeds and moves on, or fails
# loudly (distinct exit code per stage) and stops before the next one —
# there's no one watching this run to catch a problem partway through, so
# nothing partial ever reaches origin/main.
#
# Usage:
#   scripts/publish.sh brief  inbox/science-brief-2026-09-27.md [--force]
#   scripts/publish.sh review inbox/some-review.md [--slug x] [--docx y] [--figures z] [--force]
#
# Exit codes: 1 usage, 2 preflight (dirty tree / wrong branch / out of sync),
# 3 ingest failed, 4 build failed (ingested file(s) rolled back), 5 commit
# failed, 6 push failed (commit succeeded locally — push manually).

cd "$(dirname "$0")/.."

usage() {
	echo "Usage: scripts/publish.sh <brief|review> <path> [ingest-script flags...]" >&2
	echo "  brief:  scripts/publish.sh brief inbox/science-brief-2026-09-27.md [--force]" >&2
	echo "  review: scripts/publish.sh review inbox/some-review.md [--slug x] [--docx y] [--figures z] [--force]" >&2
	exit 1
}

if [ "$#" -lt 2 ]; then
	usage
fi

TYPE="$1"
INPUT="$2"
shift 2
# Remaining args ("$@") are passed through to the ingest script as-is.

case "$TYPE" in
	brief) INGEST_SCRIPT="scripts/new-brief.mjs" ;;
	review) INGEST_SCRIPT="scripts/new-review.mjs" ;;
	*) usage ;;
esac

if [ ! -e "$INPUT" ]; then
	echo "✗ Not found: $INPUT" >&2
	exit 1
fi

echo "==> Checking working tree"
if [ -n "$(git status --porcelain)" ]; then
	echo "✗ Working tree is not clean — refusing to publish on top of uncommitted changes:" >&2
	git status --short >&2
	exit 2
fi

echo "==> Checking branch and remote sync"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ]; then
	echo "✗ On '$CURRENT_BRANCH', not main — refusing to publish from a non-main branch." >&2
	exit 2
fi
git fetch origin main --quiet
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse origin/main)"
if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
	echo "✗ main is out of sync with origin/main — resolve manually before publishing." >&2
	exit 2
fi

echo "==> Ingesting ($TYPE): $INPUT"
if ! node "$INGEST_SCRIPT" "$INPUT" "$@"; then
	echo "✗ Ingest failed — nothing committed." >&2
	exit 3
fi

CHANGED_FILES="$(git status --porcelain)"
if [ -z "$CHANGED_FILES" ]; then
	echo "✗ Ingest reported success but no files changed — aborting." >&2
	exit 3
fi
echo "Files to publish:"
echo "$CHANGED_FILES" | sed 's/^/  /'

rollback_ingested_files() {
	# A here-string, not a pipe, so this loop runs in the current shell —
	# a pipe into `while` runs the loop in a subshell in bash, which would
	# make set -e's propagation out of a failing git/rm here unreliable.
	while IFS= read -r line; do
		status="${line:0:2}"
		file="${line:3}"
		if [ "$status" = "??" ]; then
			rm -f "$file"
		else
			git checkout -- "$file"
		fi
	done <<< "$CHANGED_FILES"
}

echo "==> Building"
if ! npm run build; then
	echo "✗ Build failed after ingest — rolling back the ingested file(s)." >&2
	rollback_ingested_files
	exit 4
fi

echo "==> Committing"
while IFS= read -r line; do
	git add -- "${line:3}"
done <<< "$CHANGED_FILES"
COMMIT_SUBJECT="Publish $TYPE: $(basename "$INPUT")"
if ! git commit -m "$COMMIT_SUBJECT"; then
	echo "✗ Commit failed." >&2
	exit 5
fi

echo "==> Pushing"
if ! git push origin main; then
	echo "✗ Push failed. Commit succeeded locally at $(git rev-parse HEAD) — push manually once resolved." >&2
	exit 6
fi

echo "✓ Published $TYPE from $INPUT"
