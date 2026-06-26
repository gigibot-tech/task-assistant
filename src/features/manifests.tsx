import type { ReactNode } from 'react'
import WorkplacePanel from '../components/WorkplacePanel'
import SubtaskPanel from '../components/SubtaskPanel'
import PhasePanel from '../components/PhasePanel'
import TaskDrivePanel from '../components/TaskDrivePanel'
import TaskSmePanel from '../components/TaskSmePanel'
import type { Task } from '../store/taskStore'
import { isFeatureEnabled, type FeatureFlags, type FeatureId } from './types'

export interface TaskDetailSlotProps {
  task: Task
  flags: FeatureFlags
  onUpdate: (updates: Partial<Task>) => Promise<void>
}

type TaskDetailSlot = {
  id: string
  order: number
  gatedBy?: FeatureId
  render: (props: TaskDetailSlotProps) => ReactNode
}

const TASK_DETAIL_SLOTS: TaskDetailSlot[] = [
  {
    id: 'workplace',
    order: 10,
    render: ({ task, onUpdate, flags }) => (
      <WorkplacePanel task={task} flags={flags} onUpdate={onUpdate} />
    )
  },
  {
    id: 'taskDrive',
    order: 15,
    render: ({ task, onUpdate }) => <TaskDrivePanel task={task} onUpdate={onUpdate} />
  },
  {
    id: 'smeValidator',
    order: 18,
    gatedBy: 'smeValidator',
    render: ({ task, onUpdate }) => <TaskSmePanel task={task} onUpdate={onUpdate} />
  },
  {
    id: 'subtaskProbe',
    order: 20,
    gatedBy: 'subtaskProbe',
    render: ({ task, flags, onUpdate }) => (
      <SubtaskPanel task={task} flags={flags} onUpdate={onUpdate} />
    )
  },
  {
    id: 'softwarePhases',
    order: 30,
    gatedBy: 'softwarePhases',
    render: ({ task, flags, onUpdate }) => (
      <PhasePanel task={task} flags={flags} onUpdate={onUpdate} />
    )
  }
]

export function renderTaskDetailSlots(props: TaskDetailSlotProps): ReactNode[] {
  return TASK_DETAIL_SLOTS.filter(
    (slot) => !slot.gatedBy || isFeatureEnabled(props.flags, slot.gatedBy)
  )
    .sort((a, b) => a.order - b.order)
    .map((slot) => slot.render(props))
}
