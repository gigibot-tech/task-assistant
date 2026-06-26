#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/andrearachetta/Library/CloudStorage/OneDrive-Persönlich"
PROJECT="/Users/andrearachetta/Documents/old_pilots/task-assistant"
SORTER="${PROJECT}/semantic-sorter"
REPORTS="${SORTER}/sample-reports"

cd "$PROJECT"

python3 "${SORTER}/sort_files.py" \
  --source "$ROOT" \
  --dest-root "$ROOT/_Sorted" \
  --personal-root "$ROOT" \
  --knowledge "${SORTER}/knowledge.example.json" \
  --feedback "${SORTER}/feedback.jsonl" \
  --report-md "${REPORTS}/semantic_sorter_onedrive_root_dry_run.md" \
  --report-csv "${REPORTS}/semantic_sorter_onedrive_root_dry_run.csv"

python3 "${SORTER}/sort_files.py" \
  --source "$ROOT/Documents" \
  --dest-root "$ROOT/_Sorted" \
  --personal-root "$ROOT" \
  --knowledge "${SORTER}/knowledge.example.json" \
  --feedback "${SORTER}/feedback.jsonl" \
  --report-md "${REPORTS}/semantic_sorter_documents_dry_run.md" \
  --report-csv "${REPORTS}/semantic_sorter_documents_dry_run.csv"
