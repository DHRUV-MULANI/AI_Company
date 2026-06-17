import { describe, it, expect, beforeEach } from 'vitest'
import { TaskBoard } from '../../../src/stores/task-board.js'
import { ActivityLog } from '../../../src/stores/activity-log.js'
import type { Task } from '../../../src/types.js'

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        title: 'Build feature',
        owner: 'CTO',
        status: 'PENDING',
        priority: 'MEDIUM',
        sprint_id: 'sprint-1',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        ...overrides,
    }
}

describe('TaskBoard', () => {
    let log: ActivityLog
    let board: TaskBoard

    beforeEach(() => {
        log = new ActivityLog()
        board = new TaskBoard(log)
    })

    // ─── createTask ────────────────────────────────────────────────────────────

    describe('createTask', () => {
        it('returns the created task', () => {
            const task = makeTask()
            const result = board.createTask(task)
            expect(result).toMatchObject({ id: 'task-1', title: 'Build feature' })
        })

        it('stores the task so getTask returns it', () => {
            board.createTask(makeTask())
            expect(board.getTask('task-1')).not.toBeNull()
        })

        it('auto-sets created_at if not provided', () => {
            const task = makeTask()
            delete (task as any).created_at
            const result = board.createTask(task)
            expect(result.created_at).toBeTruthy()
            expect(new Date(result.created_at).toISOString()).toBe(result.created_at)
        })

        it('auto-sets updated_at if not provided', () => {
            const task = makeTask()
            delete (task as any).updated_at
            const result = board.createTask(task)
            expect(result.updated_at).toBeTruthy()
        })

        it('preserves provided created_at and updated_at', () => {
            const task = makeTask({ created_at: '2023-06-01T00:00:00.000Z', updated_at: '2023-06-01T00:00:00.000Z' })
            const result = board.createTask(task)
            expect(result.created_at).toBe('2023-06-01T00:00:00.000Z')
            expect(result.updated_at).toBe('2023-06-01T00:00:00.000Z')
        })

        it('returns a copy — mutating the result does not affect the store', () => {
            board.createTask(makeTask())
            const result = board.createTask(makeTask({ id: 'task-2' }))
                ; (result as any).title = 'mutated'
            expect(board.getTask('task-2')!.title).toBe('Build feature')
        })

        it.each(['id', 'title', 'owner', 'status', 'priority', 'sprint_id'] as const)(
            'throws when required field "%s" is missing',
            (field) => {
                const task = makeTask({ [field]: '' as any })
                expect(() => board.createTask(task)).toThrow(field)
            }
        )

        it('throws when id is undefined', () => {
            const task = makeTask()
            delete (task as any).id
            expect(() => board.createTask(task)).toThrow('id')
        })
    })

    // ─── valid transitions ─────────────────────────────────────────────────────

    describe('valid state transitions', () => {
        it('PENDING → IN_PROGRESS succeeds', () => {
            board.createTask(makeTask({ status: 'PENDING' }))
            const result = board.updateTask('task-1', { status: 'IN_PROGRESS' })
            expect(result.status).toBe('IN_PROGRESS')
        })

        it('IN_PROGRESS → BLOCKED succeeds', () => {
            board.createTask(makeTask({ status: 'IN_PROGRESS' }))
            const result = board.updateTask('task-1', { status: 'BLOCKED' })
            expect(result.status).toBe('BLOCKED')
        })

        it('IN_PROGRESS → COMPLETED succeeds', () => {
            board.createTask(makeTask({ status: 'IN_PROGRESS' }))
            const result = board.updateTask('task-1', { status: 'COMPLETED' })
            expect(result.status).toBe('COMPLETED')
        })

        it('BLOCKED → IN_PROGRESS succeeds', () => {
            board.createTask(makeTask({ status: 'BLOCKED' }))
            const result = board.updateTask('task-1', { status: 'IN_PROGRESS' })
            expect(result.status).toBe('IN_PROGRESS')
        })

        it('updateTask always refreshes updated_at', () => {
            const task = makeTask({ updated_at: '2020-01-01T00:00:00.000Z' })
            board.createTask(task)
            const result = board.updateTask('task-1', { title: 'New title' })
            expect(result.updated_at).not.toBe('2020-01-01T00:00:00.000Z')
        })
    })

    // ─── invalid transitions ───────────────────────────────────────────────────

    describe('invalid state transitions', () => {
        it('PENDING → BLOCKED throws', () => {
            board.createTask(makeTask({ status: 'PENDING' }))
            expect(() => board.updateTask('task-1', { status: 'BLOCKED' })).toThrow(/PENDING.*BLOCKED|BLOCKED.*PENDING/)
        })

        it('PENDING → COMPLETED throws', () => {
            board.createTask(makeTask({ status: 'PENDING' }))
            expect(() => board.updateTask('task-1', { status: 'COMPLETED' })).toThrow()
        })

        it('COMPLETED → IN_PROGRESS throws', () => {
            board.createTask(makeTask({ status: 'COMPLETED' }))
            expect(() => board.updateTask('task-1', { status: 'IN_PROGRESS' })).toThrow()
        })

        it('BLOCKED → COMPLETED throws', () => {
            board.createTask(makeTask({ status: 'BLOCKED' }))
            expect(() => board.updateTask('task-1', { status: 'COMPLETED' })).toThrow()
        })

        it('invalid transition logs INVALID_TASK_TRANSITION to activity log', () => {
            board.createTask(makeTask({ status: 'PENDING' }))
            try { board.updateTask('task-1', { status: 'COMPLETED' }) } catch { /* expected */ }
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'INVALID_TASK_TRANSITION')).toBe(true)
        })

        it('invalid transition error message includes both states', () => {
            board.createTask(makeTask({ status: 'PENDING' }))
            expect(() => board.updateTask('task-1', { status: 'COMPLETED' }))
                .toThrow(/PENDING/)
        })

        it('task remains in original state after invalid transition', () => {
            board.createTask(makeTask({ status: 'PENDING' }))
            try { board.updateTask('task-1', { status: 'COMPLETED' }) } catch { /* expected */ }
            expect(board.getTask('task-1')!.status).toBe('PENDING')
        })
    })

    // ─── getTask ───────────────────────────────────────────────────────────────

    describe('getTask', () => {
        it('returns null for unknown id', () => {
            expect(board.getTask('nonexistent')).toBeNull()
        })

        it('returns a copy — mutating it does not affect the store', () => {
            board.createTask(makeTask())
            const t = board.getTask('task-1')!
            t.title = 'mutated'
            expect(board.getTask('task-1')!.title).toBe('Build feature')
        })
    })

    // ─── getAllTasks ───────────────────────────────────────────────────────────

    describe('getAllTasks', () => {
        it('returns empty array when no tasks exist', () => {
            expect(board.getAllTasks()).toEqual([])
        })

        it('returns all created tasks', () => {
            board.createTask(makeTask({ id: 't1' }))
            board.createTask(makeTask({ id: 't2' }))
            expect(board.getAllTasks()).toHaveLength(2)
        })

        it('returns copies — mutating results does not affect the store', () => {
            board.createTask(makeTask())
            const all = board.getAllTasks()
            all[0].title = 'mutated'
            expect(board.getTask('task-1')!.title).toBe('Build feature')
        })
    })

    // ─── getTasksByStatus ──────────────────────────────────────────────────────

    describe('getTasksByStatus', () => {
        beforeEach(() => {
            board.createTask(makeTask({ id: 't1', status: 'PENDING' }))
            board.createTask(makeTask({ id: 't2', status: 'IN_PROGRESS' }))
            board.createTask(makeTask({ id: 't3', status: 'IN_PROGRESS' }))
            board.createTask(makeTask({ id: 't4', status: 'COMPLETED' }))
        })

        it('returns only tasks with the given status', () => {
            const result = board.getTasksByStatus('IN_PROGRESS')
            expect(result).toHaveLength(2)
            expect(result.every(t => t.status === 'IN_PROGRESS')).toBe(true)
        })

        it('returns empty array when no tasks match the status', () => {
            expect(board.getTasksByStatus('BLOCKED')).toEqual([])
        })

        it('returns copies — mutating results does not affect the store', () => {
            const result = board.getTasksByStatus('PENDING')
            result[0].title = 'mutated'
            expect(board.getTask('t1')!.title).toBe('Build feature')
        })
    })

    // ─── blocker_reason ────────────────────────────────────────────────────────

    describe('blocker_reason', () => {
        it('stores blocker_reason when transitioning to BLOCKED', () => {
            board.createTask(makeTask({ status: 'IN_PROGRESS' }))
            const result = board.updateTask('task-1', { status: 'BLOCKED', blocker_reason: 'Waiting on API' })
            expect(result.blocker_reason).toBe('Waiting on API')
        })

        it('blocker_reason is preserved on subsequent reads', () => {
            board.createTask(makeTask({ status: 'IN_PROGRESS' }))
            board.updateTask('task-1', { status: 'BLOCKED', blocker_reason: 'Dependency missing' })
            expect(board.getTask('task-1')!.blocker_reason).toBe('Dependency missing')
        })
    })

    // ─── updateTask error cases ────────────────────────────────────────────────

    describe('updateTask error cases', () => {
        it('throws when task id does not exist', () => {
            expect(() => board.updateTask('ghost', { title: 'x' })).toThrow(/ghost/)
        })
    })
})
