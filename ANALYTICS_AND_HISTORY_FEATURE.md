# Analytics & Screenshot History Feature ✅

## Overview
Complete analytics dashboard with screenshot history tracking for each task. Every screenshot is analyzed by Gemma 4 AI and saved with predictions, recommendations, and activity labels.

## New Components

### 1. TaskAnalytics.tsx (382 lines)
Comprehensive analytics dashboard with:

#### Overview Stats
- Total tasks count
- Completed tasks
- In-progress tasks  
- Deviation rate percentage

#### Time Analytics
- Total time spent across all tasks
- Average completion time
- Most productive hours (top 3)

#### Priority Distribution
- Visual bars showing high/medium/low priority tasks
- Percentage breakdown

#### Task History
- List of all tasks with screenshot counts
- Click to view detailed history
- Status badges (completed/in-progress/pending)

#### Task Details Modal
- Full task information
- Complete screenshot history
- Each screenshot shows:
  - Timestamp
  - AI prediction of activity
  - Activity label (coding, browsing, email, etc.)
  - Recommendation from AI
  - Deviation score (color-coded)
  - Screenshot file path

## Data Model Enhancement

### Task Object (Enhanced)
```typescript
{
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  timeSpent: number  // minutes
  created_at: string
  updated_at: string
  completed_at?: string
  screenshots: ScreenshotAnalysis[]  // NEW!
}
```

### ScreenshotAnalysis Object
```typescript
{
  timestamp: string           // When captured
  imagePath: string          // Full path to PNG file
  aiPrediction: string       // "User is browsing Twitter"
  activityLabel: string      // "social_media"
  recommendation: string     // "Return to documentation task"
  deviationScore: number     // 0-1 (0=on track, 1=high deviation)
}
```

## New IPC Handler

### `analyze-screenshot-for-task`
```typescript
window.electron.analyzeScreenshotForTask(taskId, screenshotPath)
```

**What it does:**
1. Captures current screen as base64
2. Sends to Gemma 4 for analysis
3. Gets activity description and label
4. Compares with task description
5. Calculates deviation score
6. Saves analysis to task's screenshot history
7. Returns complete analysis object

**AI Prompts Used:**

1. **Activity Analysis:**
```
Analyze this screenshot and describe what the user is doing.
Provide:
1. Activity description
2. Activity label (e.g., "coding", "browsing", "email")
3. Recommendation for staying focused
```

2. **Deviation Calculation:**
```
Compare these activities:
Task: [task description]
Current Activity: [AI detected activity]
Rate similarity 0-1
```

## Usage Flow

### 1. User Working on Task
```typescript
// User starts task
const task = await window.electron.createTask({
  title: "Write documentation",
  description: "Complete API documentation",
  priority: "high"
})
```

### 2. Periodic Screenshot Capture
```typescript
// Every 5 minutes (or manual)
const screenshot = await window.electron.captureScreen()

// Analyze and save to task
const analysis = await window.electron.analyzeScreenshotForTask(
  task.id,
  screenshot.imagePath
)

// Result saved to task.screenshots[]
```

### 3. View Analytics
```typescript
// User opens analytics tab
<TaskAnalytics />

// Shows:
// - All tasks with screenshot counts
// - Click task to see full history
// - Each screenshot with AI analysis
```

## Example Screenshot Analysis

### Scenario: User Deviating
```json
{
  "timestamp": "2026-06-19T10:30:00Z",
  "imagePath": "/Users/.../screenshots/screen-2026-06-19T10-30-00.png",
  "aiPrediction": "User is browsing Twitter feed, reading tweets about technology news",
  "activityLabel": "social_media",
  "recommendation": "You're working on documentation. Consider closing social media and returning to your writing task.",
  "deviationScore": 0.85
}
```

### Scenario: User On Track
```json
{
  "timestamp": "2026-06-19T10:35:00Z",
  "imagePath": "/Users/.../screenshots/screen-2026-06-19T10-35-00.png",
  "aiPrediction": "User is writing in a text editor, appears to be working on API documentation with code examples",
  "activityLabel": "documentation",
  "recommendation": "Great focus! Continue with the current task.",
  "deviationScore": 0.05
}
```

## Visual Indicators

### Deviation Score Colors
- **Green (0.0-0.3)**: On track ✅
- **Yellow (0.3-0.7)**: Medium deviation ⚠️
- **Red (0.7-1.0)**: High deviation 🚨

### Activity Labels
Common labels detected by AI:
- `coding` - Writing code
- `documentation` - Writing docs
- `browsing` - Web browsing
- `social_media` - Twitter, Facebook, etc.
- `email` - Email client
- `meeting` - Video call
- `research` - Reading articles
- `debugging` - Looking at logs/errors
- `design` - Design tools
- `unknown` - Can't determine

## Analytics Calculations

### Deviation Rate
```typescript
deviationRate = 
  (total screenshots with score > 0.5) / 
  (total screenshots across all tasks)
```

### Most Productive Hours
```typescript
// Count screenshots per hour
// Top 3 hours with most activity
// Example: ["9:00", "14:00", "16:00"]
```

### Average Completion Time
```typescript
avgTime = 
  sum(completed_tasks.timeSpent) / 
  completed_tasks.length
```

## Integration Points

### Main Process
- `electron/main/index.ts` - New IPC handler (lines 340-435)
- Integrates with existing task CRUD operations
- Uses Gemma 4 for AI analysis
- Saves to JSON data store

### Preload Script
- `electron/preload/index.ts` - Exposed API
- Type-safe interface
- Promise-based async operations

### React Components
- `src/components/TaskAnalytics.tsx` - Full dashboard
- `src/components/ScreenCapture.tsx` - Capture UI
- Integration with existing task components

## Future Enhancements

### Automatic Capture
```typescript
// Start monitoring when task begins
setInterval(async () => {
  if (currentTask && currentTask.status === 'in_progress') {
    const screenshot = await window.electron.captureScreen()
    await window.electron.analyzeScreenshotForTask(
      currentTask.id,
      screenshot.imagePath
    )
  }
}, 5 * 60 * 1000) // Every 5 minutes
```

### Real-time Alerts
```typescript
// Show notification if deviation detected
if (analysis.deviationScore > 0.7) {
  showNotification({
    title: "High Deviation Detected!",
    body: analysis.recommendation,
    urgency: "critical"
  })
}
```

### Export Reports
```typescript
// Generate PDF report
const report = generateTaskReport(task)
// Includes:
// - Task summary
// - All screenshots
// - AI analysis
// - Time breakdown
// - Deviation timeline
```

### Activity Timeline
```typescript
// Visual timeline of activities
<Timeline>
  {task.screenshots.map(s => (
    <TimelineItem
      time={s.timestamp}
      activity={s.activityLabel}
      deviation={s.deviationScore}
    />
  ))}
</Timeline>
```

## Benefits

### For Users
- ✅ **Visual proof** of work done
- ✅ **AI insights** into productivity patterns
- ✅ **Automatic tracking** - no manual logging
- ✅ **Deviation alerts** - stay focused
- ✅ **Historical record** - review past work

### For Productivity
- ✅ **Identify distractions** - see when you deviate
- ✅ **Optimize schedule** - find productive hours
- ✅ **Track progress** - visual timeline
- ✅ **Improve estimates** - learn from history
- ✅ **Build habits** - see patterns over time

## Privacy & Security

- ✅ All screenshots stored locally
- ✅ AI analysis happens on your machine (Ollama)
- ✅ No data sent to cloud
- ✅ User controls when to capture
- ✅ Can delete screenshots anytime
- ⚠️ Future: Add privacy mode to blur sensitive content

## Summary

The analytics and screenshot history feature provides:

1. **Complete Task History** - Every task has a visual record
2. **AI-Powered Insights** - Gemma 4 analyzes each screenshot
3. **Deviation Tracking** - Know when you're off-track
4. **Productivity Analytics** - Understand your work patterns
5. **Visual Dashboard** - Beautiful UI to explore data

All integrated seamlessly with the existing task management system! 🎯📊