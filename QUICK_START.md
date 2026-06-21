# Task Assistant - Quick Start Guide

## Overview
Task Assistant is an AI-powered desktop application that helps you stay focused and productive by:
- **Semantic Deviation Detection**: Alerts when you drift from your planned tasks
- **SME Opinion Validation**: Validates your approach against domain expertise
- **AI Time Estimation**: Predicts task completion times with confidence scores
- **Communication Suggestions**: Improves your messages in real-time

## Prerequisites

### 1. Install Ollama
```bash
# macOS
brew install ollama

# Or download from https://ollama.ai
```

### 2. Start Ollama Service
```bash
ollama serve
```

### 3. Download the AI Model (if not already installed)
```bash
# You already have gemma4:latest (12B model)
# If you need to pull it:
ollama pull gemma4:latest
```

## Running the Application

### Development Mode
```bash
cd task-assistant
npm install
npm run electron:dev
```

The app will open with:
- Hot reload enabled
- DevTools open for debugging
- Full AI features active

### Production Build
```bash
npm run build
npm run electron:build
```

## Features Guide

### 1. Task Management
- **Create Tasks**: Click "New Task" button
- **Set Priority**: Choose Low/Medium/High
- **Add Tags**: Organize with custom tags
- **Subtasks**: Break down complex tasks

### 2. Semantic Deviation Detection
When you're working on a task:
1. The app monitors your current activity
2. AI compares it to your planned task
3. Alerts appear if you deviate significantly
4. Severity levels: Low (>60% match), Medium (40-60%), High (<40%)

### 3. AI Time Estimation
For each task:
- AI analyzes description and subtasks
- Provides time estimate in minutes
- Shows confidence score (0-1)
- Breaks down time by subtask

### 4. Communication Suggestions
In the task form:
- Type title or description (3+ words)
- AI suggestions appear automatically
- Click a suggestion to apply it

### 5. SME Opinion Validation
Use the **SME Validation** sidebar tab:
- Enter topic/domain and your approach
- AI validates against expert knowledge
- Shows alignment score and feedback

## Troubleshooting

### "Cannot connect to Ollama"
**Solution**: Ensure Ollama is running
```bash
ollama serve
```

### "Model not found"
**Solution**: Download the model
```bash
ollama pull gemma4:latest
```

### App won't start
**Solution**: Check Node.js version
```bash
node --version  # Should be v18+ or v20+
```

### Slow AI responses
**Cause**: First request initializes the model (takes 5-10 seconds)
**Solution**: Subsequent requests will be faster

## Data Storage

All data is stored locally in:
```
~/Library/Application Support/task-assistant/data.json
```

No data is sent to external servers. All AI processing happens locally via Ollama.

## Keyboard Shortcuts

Not yet implemented — use sidebar and task detail panel buttons.

## System Tray

The app runs in the system tray:
- Click icon to show/hide window
- Right-click for menu
- Continues running when window is closed

## Architecture

```
┌─────────────────────────────────────┐
│         Electron Main Process       │
│  - Data Storage (JSON files)        │
│  - Ollama Integration (axios)       │
│  - IPC Handlers                     │
└─────────────────────────────────────┘
                 ↕
┌─────────────────────────────────────┐
│      React Frontend (Renderer)      │
│  - UI Components (Tailwind CSS)     │
│  - State Management (Zustand)       │
│  - Type-safe IPC Bridge             │
└─────────────────────────────────────┘
                 ↕
┌─────────────────────────────────────┐
│         Ollama (Local LLM)          │
│  - Model: gemma4:latest             │
│  - HTTP API: localhost:11434        │
│  - No internet required             │
└─────────────────────────────────────┘
```

## Technology Stack

- **Frontend**: React 19 + TypeScript + electron-vite
- **Desktop**: Electron 35
- **Styling**: Tailwind CSS
- **State**: Zustand 5
- **AI**: Ollama (gemma4:latest)
- **HTTP**: Axios
- **Storage**: JSON files (no native dependencies)

## Development Tips

### Hot Reload
Changes to React components reload automatically. Changes to Electron main process require restart.

### Debugging
- Frontend: Use Chrome DevTools (opens automatically in dev mode)
- Backend: Add `console.log()` in electron/main/index.ts

### Testing AI Features
Use the built-in test prompts:
```typescript
// In DevTools console
window.electron.checkDeviation("Writing documentation", "Coding new feature")
window.electron.estimateTime({ description: "Build login page", subtasks: [] })
```

## Next Steps

1. **Customize**: Edit `src/App.tsx` for UI changes
2. **Extend**: Add new AI features in `electron/main/index.ts`
3. **Deploy**: Build production version with `npm run electron:build`

## Support

For issues or questions:
- Check Ollama is running: `ollama list`
- Check logs in DevTools console
- Verify data file exists: `~/Library/Application Support/task-assistant/data.json`

## License

MIT License - See LICENSE file for details