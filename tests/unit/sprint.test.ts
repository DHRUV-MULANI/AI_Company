import { describe, it, expect, beforeEach } from 'vitest'
import { SprintStore } from '../../src/stores/sprint-store.js'
import { ActivityLog } from '../../src/stores/activity-log.js'
import { TaskBoard } from '../../src/stores/task-board.js'
import type { Sprint, Task } from '../../src/types.js'

function makeSprint(overrides: Partial<Sprint> = {}): Sprint {
    return {
        id: 'sprint-1',
        start_date: '2024-01-01T00:00:00.000Z',
        end_date: '2024-01-14T00:00:00.000Z',
        budget_allocation: 10000,
        status: 'ACTIVE',
        ...overrides,
    }
}

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        title: 'Do something',
        owner: 'CTO',
        status: 'PENDING',
        priority: 'MEDIUM',
        sprint_id: 'sprint-1',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        ...overrides,
    }
}

describe('SprintStore', () => {
    let log: ActivityLog
    let board: TaskBoard
    let store: SprintStore

    beforeEach(() => {
        log = new ActivityLog()
        board = new TaskBoard(log)
        store = new SprintStore(log, board)
    })

    // ─── createSprint ──────────────────────────────────────────────────────────

    describe('createSprint', () => {
        it('returns the created sprint', () => {
            const result = store.createSprint(makeSprint())
            expect(result).toMatchObject({ id: 'sprint-1', status: 'ACTIVE' })
        })

        it('stores the sprint so getAll returns it', () => {
            store.createSprint(makeSprint())
            expect(store.getAll()).toHaveLength(1)
        })

        it('returns a copy — mutating result does not affect store', () => {
            const result = store.createSprint(makeSprint())
            result.id = 'mutated'
            expect(store.getAll()[0].id).toBe('sprint-1')
        })

        it('logs SPRINT_STARTED to activity log', () => {
            store.createSprint(makeSprint())
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'SPRINT_STARTED')).toBe(true)
        })

        it.each(['id', 'start_date', 'end_date', 'status'] as const)(
            'throws when required field "%s" is missing',
            (field) => {
                const sprint = makeSprint({ [field]: '' as any })
                expect(() => store.createSprint(sprint)).toThrow(field)
            }
        )

        it('throws when budget_allocation is missing', () => {
            const sprint = makeSprint()
            delete (sprint as any).budget_allocation
            expect(() => store.createSprint(sprint)).toThrow('budget_allocation')
        })

        it('throws when budget_allocation is 0', () => {
            expect(() => store.createSprint(makeSprint({ budget_allocation: 0 }))).toThrow('budget_allocation')
        })

        it('throws when budget_allocation is negative', () => {
            expect(() => store.createSprint(makeSprint({ budget_allocation: -100 }))).toThrow('budget_allocation')
        })

        it('allows creating a COMPLETED sprint even when an ACTIVE sprint exists', () => {
            store.createSprint(makeSprint({ id: 'sprint-1', status: 'ACTIVE' }))
            expect(() =>
                store.createSprint(makeSprint({ id: 'sprint-2', status: 'COMPLETED' }))
            ).not.toThrow()
        })
    })

    // ─── getActiveSprint ───────────────────────────────────────────────────────

    describe('getActiveSprint', () => {
        it('returns null when no sprints exist', () => {
            expect(store.getActiveSprint()).toBeNull()
        })

        it('returns null when only COMPLETED sprints exist', () => {
            store.createSprint(makeSprint({ status: 'COMPLETED' }))
            expect(store.getActiveSprint()).toBeNull()
        })

        it('returns the ACTIVE sprint', () => {
            store.createSprint(makeSprint({ id: 'sprint-1', status: 'ACTIVE' }))
            const active = store.getActiveSprint()
            expect(active).not.toBeNull()
            expect(active!.id).toBe('sprint-1')
        })

        it('returns a copy — mutating it does not affect the store', () => {
            store.createSprint(makeSprint())
            const active = store.getActiveSprint()!
            active.id = 'mutated'
            expect(store.getActiveSprint()!.id).toBe('sprint-1')
        })
    })

    // ─── only one ACTIVE sprint at a time ──────────────────────────────────────

    describe('single ACTIVE sprint guard', () => {
        it('throws when creating a second ACTIVE sprint', () => {
            store.createSprint(makeSprint({ id: 'sprint-1', status: 'ACTIVE' }))
            expect(() =>
                store.createSprint(makeSprint({ id: 'sprint-2', status: 'ACTIVE' }))
            ).toThrow(/ACTIVE/)
        })
    })

    // ─── completeSprint ────────────────────────────────────────────────────────

    describe('completeSprint', () => {
        beforeEach(() => {
            store.createSprint(makeSprint({ id: 'sprint-1', status: 'ACTIVE' }))
        })

        it('marks the sprint as COMPLETED', () => {
            const newSprint = makeSprint({ id: 'sprint-2', status: 'ACTIVE' })
            const { completed } = store.completeSprint('sprint-1', board, newSprint)
            expect(completed.status).toBe('COMPLETED')
        })

        it('creates the new sprint as ACTIVE', () => {
            const newSprint = makeSprint({ id: 'sprint-2', status: 'ACTIVE' })
            const { next } = store.completeSprint('sprint-1', board, newSprint)
            expect(next.status).toBe('ACTIVE')
            expect(next.id).toBe('sprint-2')
        })

        it('rolls over non-COMPLETED tasks to the new sprint', () => {
            board.createTask(makeTask({ id: 't1', sprint_id: 'sprint-1', status: 'PENDING' }))
            board.createTask(makeTask({ id: 't2', sprint_id: 'sprint-1', status: 'IN_PROGRESS' }))

            store.completeSprint('sprint-1', board, makeSprint({ id: 'sprint-2' }))

            expect(board.getTask('t1')!.sprint_id).toBe('sprint-2')
            expect(board.getTask('t2')!.sprint_id).toBe('sprint-2')
        })

        it('does NOT roll over COMPLETED tasks', () => {
            board.createTask(makeTask({ id: 't1', sprint_id: 'sprint-1', status: 'COMPLETED' }))

            store.completeSprint('sprint-1', board, makeSprint({ id: 'sprint-2' }))

            expect(board.getTask('t1')!.sprint_id).toBe('sprint-1')
        })

        it('does not touch tasks from other sprints', () => {
            board.createTask(makeTask({ id: 't1', sprint_id: 'sprint-other', status: 'PENDING' }))

            store.completeSprint('sprint-1', board, makeSprint({ id: 'sprint-2' }))

            expect(board.getTask('t1')!.sprint_id).toBe('sprint-other')
        })

        it('logs SPRINT_COMPLETED to activity log', () => {
            store.completeSprint('sprint-1', board, makeSprint({ id: 'sprint-2' }))
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'SPRINT_COMPLETED')).toBe(true)
        })

        it('throws when sprint id does not exist', () => {
            expect(() =>
                store.completeSprint('nonexistent', board, makeSprint({ id: 'sprint-2' }))
            ).toThrow(/nonexistent/)
        })

        it('getAll returns both sprints after completion', () => {
            store.completeSprint('sprint-1', board, makeSprint({ id: 'sprint-2' }))
            expect(store.getAll()).toHaveLength(2)
        })
    })

    // ─── expenditure tracking ──────────────────────────────────────────────────

    describe('recordExpenditure / getExpenditures', () => {
        beforeEach(() => {
            store.createSprint(makeSprint({ id: 'sprint-1', budget_allocation: 10000 }))
        })

        it('starts at 0', () => {
            expect(store.getExpenditures('sprint-1')).toBe(0)
        })

        it('accumulates expenditures', () => {
            store.recordExpenditure('sprint-1', 1000)
            store.recordExpenditure('sprint-1', 500)
            expect(store.getExpenditures('sprint-1')).toBe(1500)
        })

        it('throws when sprint id does not exist', () => {
            expect(() => store.recordExpenditure('ghost', 100)).toThrow(/ghost/)
        })

        it('does not emit BUDGET_WARNING below 80%', () => {
            store.recordExpenditure('sprint-1', 7999)
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'BUDGET_WARNING')).toBe(false)
        })

        it('emits BUDGET_WARNING when cumulative expenditures reach exactly 80%', () => {
            store.recordExpenditure('sprint-1', 8000)
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'BUDGET_WARNING')).toBe(true)
        })

        it('emits BUDGET_WARNING when cumulative expenditures exceed 80%', () => {
            store.recordExpenditure('sprint-1', 9000)
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'BUDGET_WARNING')).toBe(true)
        })

        it('emits BUDGET_WARNING only once even with multiple calls crossing threshold', () => {
            store.recordExpenditure('sprint-1', 4000) // 40% — no warning
            store.recordExpenditure('sprint-1', 4000) // 80% — warning fires
            store.recordExpenditure('sprint-1', 1000) // 90% — already past threshold
            const warnings = log.getAll().filter(e => e.event_type === 'BUDGET_WARNING')
            expect(warnings).toHaveLength(1)
        })

        it('emits BUDGET_WARNING when threshold is crossed in a single call', () => {
            store.recordExpenditure('sprint-1', 8500)
            const entries = log.getAll()
            expect(entries.some(e => e.event_type === 'BUDGET_WARNING')).toBe(true)
        })
    })

    // ─── getAll ────────────────────────────────────────────────────────────────

    describe('getAll', () => {
        it('returns empty array when no sprints exist', () => {
            expect(store.getAll()).toEqual([])
        })

        it('returns copies — mutating results does not affect the store', () => {
            store.createSprint(makeSprint())
            const all = store.getAll()
            all[0].id = 'mutated'
            expect(store.getAll()[0].id).toBe('sprint-1')
        })
    })
})
