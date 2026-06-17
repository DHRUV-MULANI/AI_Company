import type { Task, TaskStatus } from '../types.js'
import type { TaskBoard as ITaskBoard } from '../interfaces.js'
import type { ActivityLog as IActivityLog } from '../interfaces.js'

// Valid state machine transitions
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    PENDING: ['IN_PROGRESS'],
    IN_PROGRESS: ['BLOCKED', 'COMPLETED'],
    BLOCKED: ['IN_PROGRESS'],
    COMPLETED: [],
}

const REQUIRED_FIELDS: (keyof Task)[] = ['id', 'title', 'owner', 'status', 'priority', 'sprint_id']

export class TaskBoard implements ITaskBoard {
    private readonly _tasks = new Map<string, Task>()
    private readonly _activityLog: IActivityLog

    constructor(activityLog: IActivityLog) {
        this._activityLog = activityLog
    }

    createTask(task: Task): Task {
        for (const field of REQUIRED_FIELDS) {
            const value = task[field]
            if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
                throw new Error(`Task missing required field: ${field}`)
            }
        }

        const now = new Date().toISOString()
        const stored: Task = {
            ...task,
            created_at: task.created_at ?? now,
            updated_at: task.updated_at ?? now,
        }

        this._tasks.set(stored.id, stored)
        return { ...stored }
    }

    updateTask(id: string, patch: Partial<Task>): Task {
        const existing = this._tasks.get(id)
        if (!existing) {
            throw new Error(`Task not found: ${id}`)
        }

        // Validate status transition if status is being changed
        if (patch.status !== undefined && patch.status !== existing.status) {
            const allowed = VALID_TRANSITIONS[existing.status]
            if (!allowed.includes(patch.status)) {
                const msg = `Invalid task transition: ${existing.status} → ${patch.status} (task: ${id})`
                this._activityLog.append({
                    id: `invalid-transition-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    timestamp: new Date().toISOString(),
                    agent_role: 'Operations',
                    event_type: 'INVALID_TASK_TRANSITION',
                    description: msg,
                    metadata: { task_id: id, from: existing.status, to: patch.status },
                })
                throw new Error(msg)
            }
        }

        const updated: Task = {
            ...existing,
            ...patch,
            updated_at: new Date().toISOString(),
        }

        this._tasks.set(id, updated)
        return { ...updated }
    }

    getTask(id: string): Task | null {
        const task = this._tasks.get(id)
        return task ? { ...task } : null
    }

    getAllTasks(): Task[] {
        return Array.from(this._tasks.values()).map(t => ({ ...t }))
    }

    getTasksByStatus(status: TaskStatus): Task[] {
        return Array.from(this._tasks.values())
            .filter(t => t.status === status)
            .map(t => ({ ...t }))
    }
}
