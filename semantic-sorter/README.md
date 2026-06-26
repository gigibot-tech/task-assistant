# Semantic Sorter (Task Assistant)

Bundled with Task Assistant. Use the **Desktop Sorter** view in the app for dry-run, Ollama augmentation, review, and apply.

## In-app workflow

1. Configure paths in Desktop Sorter (sort inbox, destination roots).
2. Drop files into `_Sort Inbox`.
3. **Dry run** — review the table.
4. **Review & teach** — accept or correct decisions (writes `feedback.jsonl`).
5. **Apply moves** — only after you are satisfied.

Runtime data: `~/Library/Application Support/task-assistant/semantic-sorter/`

## CLI (Hazel / terminal)

```bash
PROJECT="/Users/andrearachetta/Documents/old_pilots/task-assistant"
SORTER="$PROJECT/semantic-sorter"

python3 "$SORTER/sort_files.py" \
  --source "/path/to/_Sort Inbox" \
  --dest-root "/path/to/OneDrive" \
  --personal-root "/path/to/OneDrive" \
  --knowledge "$SORTER/knowledge.example.json" \
  --feedback "$HOME/Library/Application Support/task-assistant/semantic-sorter/feedback.jsonl" \
  --emit-json --decisions-only
```

Helper scripts:

- `run_sort_inbox_apply.sh`
- `run_personal_onedrive_dry_run.sh`

## Knowledge

Edit `knowledge.example.json` or copy to user-data `knowledge.json` on first run. Aliases, rules, and destinations drive the rule engine; Ollama only refines uncertain rows.

See [features/semantic-sorter/README.md](../features/semantic-sorter/README.md) for architecture and IPC.
