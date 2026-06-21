---
name: workplace-context
description: >-
  Workplace folder indexing and deviation recovery guidance for Task Assistant.
  Use when editing electron/main/workplace, workplace IPC, deviation recovery
  prompts, or task workplace_folder fields.
---

# Workplace Context Module

## Purpose

Per-task `workplace_folder` provides text context from the user's project directory. When a **deviation alert** fires (not every focus poll), the app runs a second Ollama pipeline to suggest where to continue working.

## Module layout

```
electron/main/workplace/
  workplacePaths.ts      — path validation, safe resolve, skip rules, settings defaults
  workplaceIndexer.ts    — filesystem tree walk → tree_text + relative_paths
  workplaceReader.ts     — read text excerpts with byte caps
  workplaceFilePicker.ts — text LLM picks 3–5 files; heuristic fallback
  deviationRecovery.ts   — dual-screenshot vision recovery → WorkplaceGuidance JSON
  workplaceContext.ts    — orchestrator + openWorkplacePath
```

Shared Ollama helpers: `electron/main/ollamaClient.ts`

## When recovery runs

- **Yes:** `sendDeviationAlert` in `index.ts` when `workplaceGuidanceEnabled` and task has `workplace_folder`
- **No:** every focus poll, snooze, break mode
- **Cooldown:** reuse `task.workplace_guidance` if younger than 10 minutes unless `forceRefresh`

## Pipeline

1. Index folder (cache on `task.workplace_index`)
2. Text LLM: pick files from tree
3. Read file excerpts (never outside workplace root)
4. Vision LLM: last on-task screenshot + current screenshot + excerpts → guidance

## Task fields

- `workplace_folder` — absolute path
- `workplace_index` — `{ indexed_at, file_count, tree_text, relative_paths? }`
- `last_on_task_capture` — set when focus check passes threshold
- `workplace_guidance` — last recovery output

## Security

- `resolveSafePath(root, rel)` must pass before any read/open
- Skip `.env`, keys, binaries; extension allowlist in `workplacePaths.ts`
- Cap tree lines and total prompt bytes via settings

## JSON schemas

**File picker response:**
```json
{"files":["src/App.tsx","README.md"]}
```

**Recovery response:**
```json
{
  "summary": "string",
  "suggested_files": [{"path": "relative/path", "reason": "why"}],
  "suggested_actions": ["step"],
  "tools_hint": "optional"
}
```

## IPC (preload v7+)

- `pick-workplace-folder`
- `index-workplace` (taskId)
- `open-workplace-path` (taskId, relativePath)
- `get-workplace-guidance` (taskId, forceRefresh?)

## UI

- `WorkplacePanel` — task detail + index/refresh/guidance
- `TaskForm` — workplace path on create/edit
- `DeviationAlert` — "Where to continue" section with open-file buttons
- `SettingsPanel` — workplace limits + master toggle

## Extending

- Add text extensions in `TEXT_EXTENSIONS` (`workplacePaths.ts`)
- Add skip dirs in `SKIP_DIR_NAMES`
- Increase `num_predict` in `deviationRecovery.ts` if responses truncate
