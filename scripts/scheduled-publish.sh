#!/usr/bin/env bash
# No -e (unlike publish.sh): publish.sh's own exit status is deliberately
# captured and inspected below (to tell "already published" apart from a
# real failure) rather than left to abort the script the instant it's
# non-zero, which -e would do even from inside this if/elif chain's body.
set -uo pipefail

# Invoked by launchd on a schedule (see scripts/com.chaperone-brief.publish.plist).
# Not run interactively, so nothing here can rely on inherited shell config —
# PATH is set explicitly below rather than assuming ~/.zshenv was sourced.
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd "$(dirname "$0")/.."

LOG_DIR="$HOME/Library/Logs/chaperone-brief"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/publish.log"

log() {
	echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $1" >> "$LOG_FILE"
}

notify() {
	# osascript needs a GUI session, which a user-level LaunchAgent has but
	# a system LaunchDaemon would not — this must stay installed as an
	# Agent (~/Library/LaunchAgents), not a Daemon.
	osascript -e "display notification \"$2\" with title \"$1\"" >/dev/null 2>&1 || true
}

log "=== scheduled-publish run starting ==="

# The "what's new" signal: inbox/ is gitignored, so nothing else records
# what's already been dropped in for publishing — the newest direct child
# .md file (not README.md, not anything in a subdirectory) is the candidate.
CANDIDATE=""
for f in inbox/*.md; do
	[ -e "$f" ] || continue
	[ "$(basename "$f")" = "README.md" ] && continue
	if [ -z "$CANDIDATE" ] || [ "$f" -nt "$CANDIDATE" ]; then
		CANDIDATE="$f"
	fi
done

if [ -z "$CANDIDATE" ]; then
	log "No candidate file in inbox/ — nothing to publish."
	exit 0
fi

BASENAME="$(basename "$CANDIDATE" .md)"
if [[ "$BASENAME" =~ ^science-brief-[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
	TYPE="brief"
else
	TYPE="review"
fi

log "Candidate: $CANDIDATE (type: $TYPE)"

DOCX="inbox/$BASENAME.docx"
FIGURES_DIR="inbox/$BASENAME-figures"
OUTPUT=""
if [ "$TYPE" = "review" ] && [ -e "$DOCX" ] && [ -d "$FIGURES_DIR" ]; then
	OUTPUT=$(scripts/publish.sh review "$CANDIDATE" --docx "$DOCX" --figures "$FIGURES_DIR" 2>&1)
	STATUS=$?
elif [ "$TYPE" = "review" ] && [ -e "$DOCX" ]; then
	OUTPUT=$(scripts/publish.sh review "$CANDIDATE" --docx "$DOCX" 2>&1)
	STATUS=$?
elif [ "$TYPE" = "review" ] && [ -d "$FIGURES_DIR" ]; then
	OUTPUT=$(scripts/publish.sh review "$CANDIDATE" --figures "$FIGURES_DIR" 2>&1)
	STATUS=$?
else
	OUTPUT=$(scripts/publish.sh "$TYPE" "$CANDIDATE" 2>&1)
	STATUS=$?
fi

log "$OUTPUT"

if [ "$STATUS" -eq 0 ]; then
	log "✓ Published successfully."
	notify "Chaperone" "Published: $BASENAME"
	log "=== scheduled-publish run complete ==="
	exit 0
fi

if echo "$OUTPUT" | grep -q "already exists"; then
	log "Nothing new — '$CANDIDATE' is already published."
	log "=== scheduled-publish run complete (no-op) ==="
	exit 0
fi

log "✗ publish.sh failed (exit $STATUS)."
notify "Chaperone — publish failed" "$BASENAME did not publish. Check $LOG_FILE"
log "=== scheduled-publish run complete (failed) ==="
exit "$STATUS"
