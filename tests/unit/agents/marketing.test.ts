import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MarketingAgent } from '../../../src/agents/marketing-agent.js'
import type { AgentMessage, Task, LockToken } from '../../../src/types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../../../src/interfaces.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLockToken(resource: string, holder: string): LockToken {
    return {
        resource: resource as LockToken['resource'],
        holder: holder as LockToken['holder'],
        acquired_at: new Date().toISOString(),
        token_id: 'tok-1',
    }
}

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        title: 'Test task',
        owner: 'Marketing',
        status: 'PENDING',
        priority: 'MEDIUM',
        sprint_id: 'sprint-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    }
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
    return {
        id: 'msg-1',
        from: 'CEO',
        to: 'Marketing',
        type: 'APPROVAL_RESPONSE',
        payload: { approved: true },
        timestamp: new Date().toISOString(),
        ...overrides,
    }
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

function makeMocks() {
    const activityLog: ActivityLog = {
        append: vi.fn(entry => entry),
        getAll: vi.fn(() => []),
        getEntriesSince: vi.fn(() => []),
    }

    const taskBoard: TaskBoard = {
        createTask: vi.fn(task => task),
        updateTask: vi.fn((id, patch) => ({ ...makeTask(), ...patch, id })),
        getTask: vi.fn(() => makeTask()),
        getAllTasks: vi.fn(() => []),
        getTasksByStatus: vi.fn(() => []),
    }

    const writeLockManager: WriteLockManager = {
        acquire: vi.fn((resource, role) => makeLockToken(resource, role)),
        release: vi.fn(),
        isLocked: vi.fn(() => false),
    }

    return { activityLog, taskBoard, writeLockManager }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MarketingAgent', () => {
    let agent: MarketingAgent
    let mocks: ReturnType<typeof makeMocks>

    beforeEach(() => {
        mocks = makeMocks()
        agent = new MarketingAgent(mocks.activityLog, mocks.taskBoard, mocks.writeLockManager)
    })

    describe('constructor', () => {
        it('sets role to Marketing', () => {
            expect(agent.role).toBe('Marketing')
        })
    })

    // ─── APPROVAL_RESPONSE approved ───────────────────────────────────────────

    describe('processMessage() — APPROVAL_RESPONSE approved', () => {
        it('logs EXPENSE_COMMITTED when approved', () => {
            const msg = makeMessage({ payload: { approved: true } })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'EXPENSE_COMMITTED')
            expect(entry).toBeDefined()
        })

        it('returns empty outbound array', () => {
            const msg = makeMessage({ payload: { approved: true } })
            const outbound = agent.processMessage(msg)
            expect(outbound).toEqual([])
        })
    })

    // ─── APPROVAL_RESPONSE rejected ───────────────────────────────────────────

    describe('processMessage() — APPROVAL_RESPONSE rejected', () => {
        it('blocks the task when rejected', () => {
            const msg = makeMessage({
                payload: { approved: false, task_id: 'task-1' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', {
                status: 'BLOCKED',
                blocker_reason: 'Campaign expense rejected by CEO',
            })
        })

        it('uses provided reason when rejected with reason', () => {
            const msg = makeMessage({
                payload: { approved: false, task_id: 'task-1', reason: 'No budget' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', {
                status: 'BLOCKED',
                blocker_reason: 'No budget',
            })
        })

        it('returns empty outbound array when rejected', () => {
            const msg = makeMessage({ payload: { approved: false, task_id: 'task-1' } })
            const outbound = agent.processMessage(msg)
            expect(outbound).toEqual([])
        })
    })

    // ─── Unhandled message types ──────────────────────────────────────────────

    describe('processMessage() — unhandled types', () => {
        it('returns empty array for unhandled message types', () => {
            const msg = makeMessage({ type: 'STATUS_UPDATE' })
            const outbound = agent.processMessage(msg)
            expect(outbound).toEqual([])
        })
    })

    // ─── tick() — self-assignment ─────────────────────────────────────────────

    describe('tick()', () => {
        it('returns an empty array', () => {
            vi.mocked(mocks.taskBoard.getTasksByStatus).mockReturnValue([])
            expect(agent.tick()).toEqual([])
        })

        it('calls updateTask for each PENDING Marketing-owned task', () => {
            const t1 = makeTask({ id: 'mkt-task-1', owner: 'Marketing', status: 'PENDING' })
            vi.mocked(mocks.taskBoard.getTasksByStatus).mockReturnValue([t1])

            agent.tick()

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('mkt-task-1', { status: 'IN_PROGRESS' })
        })

        it('does not update tasks owned by other agents', () => {
            const ceoTask = makeTask({ id: 'ceo-task-1', owner: 'CEO', status: 'PENDING' })
            vi.mocked(mocks.taskBoard.getTasksByStatus).mockReturnValue([ceoTask])

            agent.tick()

            expect(mocks.taskBoard.updateTask).not.toHaveBeenCalled()
        })

        it('queries the task board for PENDING tasks', () => {
            vi.mocked(mocks.taskBoard.getTasksByStatus).mockReturnValue([])
            agent.tick()
            expect(mocks.taskBoard.getTasksByStatus).toHaveBeenCalledWith('PENDING')
        })
    })
})
