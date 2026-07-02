import type { ReactNode } from 'react'
import WorkplacePanel from '../components/WorkplacePanel'
import PhasePanel from '../components/PhasePanel'
import TaskDrivePanel from '../components/TaskDrivePanel'
import TaskSmePanel from '../components/TaskSmePanel'
import type { Task } from '../store/taskStore'
import { isFeatureEnabled, type FeatureFlags, type FeatureId } from './types'

import type { StuckTrigger, SoftwarePhase } from '../lib/subtaskTypes'

export interface OpenProbeOptions {
  workPhase?: SoftwarePhase
  taskDay?: number
  primeDay?: number | null
}

export type OpenProbeHandler = (
  trigger: StuckTrigger,
  options?: OpenProbeOptions
) => void

export interface TaskDetailSlotProps {
  task: Task
  flags: FeatureFlags
  onUpdate: (updates: Partial<Task>) => Promise<void>
  onOpenProbe?: OpenProbeHandler
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
    render: ({ task, onUpdate, onOpenProbe }) => (
      <TaskDrivePanel task={task} onUpdate={onUpdate} onOpenProbe={onOpenProbe} />
    )
  },
  {
    id: 'smeValidator',
    order: 18,
    gatedBy: 'smeValidator',
    render: ({ task, onUpdate }) => <TaskSmePanel task={task} onUpdate={onUpdate} />
  },
  {
    id: 'softwarePhases',
    order: 30,
    gatedBy: 'softwarePhases',
    render: ({ task, flags, onUpdate, onOpenProbe }) => (
      <PhasePanel task={task} flags={flags} onUpdate={onUpdate} onOpenProbe={onOpenProbe} />
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
