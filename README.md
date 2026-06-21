# Task Assistant

AI-powered task management desktop application with local Ollama integration (gemma4:latest).

## Features

- **Task Management**: Create, edit, start, complete, and delete tasks
- **Semantic Deviation Detection**: Manual check + background polling alerts
- **AI Time Estimation**: Get estimates from gemma4:latest
- **Communication Suggestions**: AI writing help in the task form
- **SME Validation**: Validate approaches against expert knowledge
- **Focus Monitor**: Screen capture with AI activity analysis
- **Analytics**: Task history and deviation stats
- **Privacy First**: All data stored locally in JSON

## Prerequisites

1. **Node.js** 18+ and npm
2. **Ollama** — [ollama.ai](https://ollama.ai)
3. **Model**:
   ```bash
   ollama pull gemma4:latest
   ollama serve
   ```

## Installation

```bash
cd task-assistant
npm install
npm run electron:dev
```

## Building

```bash
npm run build           # compile to out/
npm run electron:build  # distributable in release/
```

## Usage

### Navigation
- **All Tasks / In Progress / Completed** — filter the task list
- **Analytics** — productivity and screenshot history
- **SME Validation** — expert opinion check
- **Focus Monitor** — screen capture linked to a task
- **Settings** — model name, deviation threshold, poll interval

### Task Detail Panel
Click a task to open details:
- Enter **Current Activity** for deviation tracking
- **Check Deviation** / **AI Estimate**
- **Start Task** / **Complete Task** / **Edit** / **Delete**

### Deviation Alerts
When background polling detects drift, an in-app alert appears with dismiss, snooze (15/30/60 min), and return-to-task actions.

## Configuration

Settings panel (default model: `gemma4:latest`):
- **Ollama Model** — override model name
- **Deviation Threshold** — similarity below which alerts fire (default 70%)
- **Poll Interval** — background check frequency (default 5 min)

## Tech Stack

- Electron 35, React 19, TypeScript 5.8
- electron-vite 5, Tailwind CSS 3, Zustand 5
- Ollama (gemma4:latest)

## Data Storage

Tasks and settings: `~/Library/Application Support/task-assistant/data.json` (macOS)

## Troubleshooting

**Buttons not working** — ensure you run via `npm run electron:dev`, not plain Vite in a browser.

**Ollama offline** — run `ollama serve` and check the status indicator in the header.

**Model not found** — run `ollama pull gemma4:latest`.

**IPC errors** — rebuild with `npm run build` and restart the app.
