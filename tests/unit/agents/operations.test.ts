import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OperationsAgent } from '../../../src/agents/operations-agent.js'
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
        owner: 'Operations',
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
        from: 'CTO',
        to: 'Operations',
        type: 'BLOCKER_ESCALATION',
        payload: { severity: 'LOW', reason: 'Dependency missing' },
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

describe('OperationsAgent', () => {
    let agent: OperationsAgent
    let mocks: ReturnType<typeof makeMocks>

    beforeEach(() => {
        mocks = makeMocks()
        agent = new OperationsAgent(mocks.activityLog, mocks.taskBoard, mocks.writeLockManager)
    })

    describe('constructor', () => {
        it('sets role to Operations', () => {
            expect(agent.role).toBe('Operations')
        })
    })

    // ─── BLOCKER_ESCALATION — non-critical ────────────────────────────────────

    describe('processMessage() — BLOCKER_ESCALATION (non-critical)', () => {
        it('logs BLOCKER_RESOLVED for non-critical escalations', () => {
            const msg = makeMessage({ payload: { severity: 'LOW', reason: 'Missing dep' } })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'BLOCKER_RESOLVED')
            expect(entry).toBeDefined()
        })

        it('emits BLOCKER_RESOLUTION back to sender for non-critical', () => {
            const msg = makeMessage({ from: 'CTO', payload: { severity: 'LOW' } })
            const outbound = agent.processMessage(msg)

            expect(outbound).toHaveLength(1)
            expect(outbound[0].type).toBe('BLOCKER_RESOLUTION')
            expect(outbound[0].to).toBe('CTO')
            expect(outbound[0].from).toBe('Operations')
        })

        it('enqueues BLOCKER_RESOLUTION in outbound buffer', () => {
            const msg = makeMessage({ payload: { severity: 'MEDIUM' } })
            agent.processMessage(msg)

            const buffered = agent.getOutboundQueue()
            expect(buffered).toHaveLength(1)
            expect(buffered[0].type).toBe('BLOCKER_RESOLUTION')
        })

        it('includes the original escalation id in the resolution payload', () => {
            const msg = makeMessage({ id: 'esc-42', payload: { severity: 'LOW' } })
            const outbound = agent.processMessage(msg)

            expect(outbound[0].payload).toMatchObject({ resolvedEscalationId: 'esc-42' })
        })
    })

    // ─── BLOCKER_ESCALATION — critical ───────────────────────────────────────

    describe('processMessage() — BLOCKER_ESCALATION (CRITICAL)', () => {
        it('forwards BLOCKER_ESCALATION to CEO for critical severity', () => {
            const msg = makeMessage({ payload: { severity: 'CRITICAL', reason: 'System down' } })
            const outbound = agent.processMessage(msg)

            expect(outbound).toHaveLength(1)
            expect(outbound[0].type).toBe('BLOCKER_ESCALATION')
            expect(outbound[0].to).toBe('CEO')
            expect(outbound[0].from).toBe('Operations')
        })

        it('does not log BLOCKER_RESOLVED for critical escalations', () => {
            const msg = makeMessage({ payload: { severity: 'CRITICAL' } })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'BLOCKER_RESOLVED')
            expect(entry).toBeUndefined()
        })

        it('enqueues the CEO escalation in the outbound buffer', () => {
            const msg = makeMessage({ payload: { severity: 'CRITICAL' } })
            agent.processMessage(msg)

            const buffered = agent.getOutboundQueue()
            expect(buffered).toHaveLength(1)
            expect(buffered[0].to).toBe('CEO')
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

        it('calls updateTask for each PENDING Operations-owned task', () => {
            const t1 = makeTask({ id: 'ops-task-1', owner: 'Operations', status: 'PENDING' })
            vi.mocked(mocks.taskBoard.getTasksByStatus).mockReturnValue([t1])

            agent.tick()

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('ops-task-1', { status: 'IN_PROGRESS' })
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
