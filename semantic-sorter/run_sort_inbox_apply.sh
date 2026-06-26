#!/usr/bin/env bash
set -euo pipefail

PERSONAL_ROOT="/Users/andrearachetta/Library/CloudStorage/OneDrive-Persönlich"
HS_ROOT="/Users/andrearachetta/Library/CloudStorage/OneDrive-HS-Hannover"
PROJECT="/Users/andrearachetta/Documents/old_pilots/task-assistant"
SORTER="${PROJECT}/semantic-sorter"
INBOX="${1:-$PERSONAL_ROOT/_Sort Inbox}"

cd "$PROJECT"

if [ ! -d "$HS_ROOT" ]; then
  echo "HS-Hannover OneDrive is not mounted at: $HS_ROOT"
  echo "Academic files will be routed to _Needs HS-Hannover Mount unless you edit HS_ROOT."
  HS_ARG=()
else
  HS_ARG=(--hs-root "$HS_ROOT")
fi

python3 "${SORTER}/sort_files.py" \
  --source "$INBOX" \
  --dest-root "$PERSONAL_ROOT" \
  --personal-root "$PERSONAL_ROOT" \
  --knowledge "${SORTER}/knowledge.example.json" \
  --feedback "${SORTER}/feedback.jsonl" \
  "${HS_ARG[@]}" \
  --apply
