import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CTOAgent } from '../../../src/agents/cto-agent.js'
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
        owner: 'CTO',
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
        to: 'CTO',
        type: 'TASK_ASSIGNMENT',
        payload: { task_id: 'task-1' },
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

describe('CTOAgent', () => {
    let agent: CTOAgent
    let mocks: ReturnType<typeof makeMocks>

    beforeEach(() => {
        mocks = makeMocks()
        agent = new CTOAgent(mocks.activityLog, mocks.taskBoard, mocks.writeLockManager)
    })

    describe('constructor', () => {
        it('sets role to CTO', () => {
            expect(agent.role).toBe('CTO')
        })
    })

    // ─── TASK_ASSIGNMENT handling ─────────────────────────────────────────────

    describe('processMessage() — TASK_ASSIGNMENT', () => {
        it('updates the task to IN_PROGRESS', () => {
            const msg = makeMessage({ type: 'TASK_ASSIGNMENT', payload: { task_id: 'task-42' } })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-42', { status: 'IN_PROGRESS' })
        })

        it('returns empty outbound array', () => {
            const msg = makeMessage({ type: 'TASK_ASSIGNMENT' })
            const outbound = agent.processMessage(msg)
            expect(outbound).toEqual([])
        })
    })

    // ─── BLOCKER_RESOLUTION handling ──────────────────────────────────────────

    describe('processMessage() — BLOCKER_RESOLUTION', () => {
        it('updates the blocked task back to IN_PROGRESS', () => {
            const msg = makeMessage({
                type: 'BLOCKER_RESOLUTION',
                payload: { task_id: 'task-blocked' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-blocked', { status: 'IN_PROGRESS' })
        })

        it('logs BLOCKER_RESOLVED', () => {
            const msg = makeMessage({
                type: 'BLOCKER_RESOLUTION',
                payload: { task_id: 'task-1' },
            })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'BLOCKER_RESOLVED')
            expect(entry).toBeDefined()
        })

        it('returns empty outbound array', () => {
            const msg = makeMessage({ type: 'BLOCKER_RESOLUTION', payload: { task_id: 'task-1' } })
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

        it('calls updateTask for each PENDING CTO-owned task', () => {
            const t1 = makeTask({ id: 'cto-task-1', owner: 'CTO', status: 'PENDING' })
            const t2 = makeTask({ id: 'cto-task-2', owner: 'CTO', status: 'PENDING' })
            vi.mocked(mocks.taskBoard.getTasksByStatus).mockReturnValue([t1, t2])

            agent.tick()

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('cto-task-1', { status: 'IN_PROGRESS' })
            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('cto-task-2', { status: 'IN_PROGRESS' })
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
