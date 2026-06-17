import type { Sprint, ActivityEntry } from '../types.js'
import type { ActivityLog as IActivityLog } from '../interfaces.js'
import type { TaskBoard as ITaskBoard } from '../interfaces.js'

const REQUIRED_FIELDS: (keyof Sprint)[] = ['id', 'start_date', 'end_date', 'budget_allocation', 'status']

export class SprintStore {
    private readonly _sprints = new Map<string, Sprint>()
    private readonly _expenditures = new Map<string, number>()
    private readonly _activityLog: IActivityLog
    private readonly _taskBoard: ITaskBoard

    constructor(activityLog: IActivityLog, taskBoard: ITaskBoard) {
        this._activityLog = activityLog
        this._taskBoard = taskBoard
    }

    createSprint(sprint: Sprint): Sprint {
        // Validate required fields
        for (const field of REQUIRED_FIELDS) {
            const value = sprint[field]
            if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
                throw new Error(`Sprint missing required field: ${field}`)
            }
        }

        if (sprint.budget_allocation <= 0) {
            throw new Error('Sprint budget_allocation must be > 0')
        }

        // Enforce single ACTIVE sprint
        if (sprint.status === 'ACTIVE') {
            const existing = this.getActiveSprint()
            if (existing) {
                throw new Error(`Cannot create ACTIVE sprint: sprint ${existing.id} is already ACTIVE`)
            }
        }

        const stored: Sprint = { ...sprint }
        this._sprints.set(stored.id, stored)
        this._expenditures.set(stored.id, 0)

        this._activityLog.append({
            id: `sprint-started-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            timestamp: new Date().toISOString(),
            agent_role: 'Operations',
            event_type: 'SPRINT_STARTED',
            description: `Sprint ${stored.id} started`,
            metadata: { sprint_id: stored.id },
        } satisfies ActivityEntry)

        return { ...stored }
    }

    getActiveSprint(): Sprint | null {
        for (const sprint of this._sprints.values()) {
            if (sprint.status === 'ACTIVE') {
                return { ...sprint }
            }
        }
        return null
    }

    completeSprint(
        sprintId: string,
        taskBoard: ITaskBoard,
        newSprintData: Sprint,
    ): { completed: Sprint; next: Sprint } {
        const sprint = this._sprints.get(sprintId)
        if (!sprint) {
            throw new Error(`Sprint not found: ${sprintId}`)
        }

        // Mark current sprint as COMPLETED
        const completed: Sprint = { ...sprint, status: 'COMPLETED' }
        this._sprints.set(sprintId, completed)

        this._activityLog.append({
            id: `sprint-completed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            timestamp: new Date().toISOString(),
            agent_role: 'Operations',
            event_type: 'SPRINT_COMPLETED',
            description: `Sprint ${sprintId} completed`,
            metadata: { sprint_id: sprintId },
        } satisfies ActivityEntry)

        // Roll over non-COMPLETED tasks to the new sprint
        const allTasks = taskBoard.getAllTasks()
        for (const task of allTasks) {
            if (task.sprint_id === sprintId && task.status !== 'COMPLETED') {
                taskBoard.updateTask(task.id, { sprint_id: newSprintData.id })
            }
        }

        // Create the new sprint as ACTIVE
        const next = this.createSprint({ ...newSprintData, status: 'ACTIVE' })

        return { completed: { ...completed }, next }
    }

    getAll(): Sprint[] {
        return Array.from(this._sprints.values()).map(s => ({ ...s }))
    }

    recordExpenditure(sprintId: string, amount: number): void {
        const sprint = this._sprints.get(sprintId)
        if (!sprint) {
            throw new Error(`Sprint not found: ${sprintId}`)
        }

        const previous = this._expenditures.get(sprintId) ?? 0
        const updated = previous + amount
        this._expenditures.set(sprintId, updated)

        const threshold = sprint.budget_allocation * 0.8
        if (previous < threshold && updated >= threshold) {
            this._activityLog.append({
                id: `budget-warning-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                timestamp: new Date().toISOString(),
                agent_role: 'Finance',
                event_type: 'BUDGET_WARNING',
                description: `Sprint ${sprintId} has reached 80% of budget allocation (${updated} / ${sprint.budget_allocation})`,
                metadata: {
                    sprint_id: sprintId,
                    expenditures: updated,
                    budget_allocation: sprint.budget_allocation,
                },
            } satisfies ActivityEntry)
        }
    }

    getExpenditures(sprintId: string): number {
        return this._expenditures.get(sprintId) ?? 0
    }
}
