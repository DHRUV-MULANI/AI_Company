import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BaseAgent } from '../../../src/agents/base-agent.js'
import type { AgentMessage, AgentRole, Task } from '../../../src/types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../../../src/interfaces.js'
import type { LockToken } from '../../../src/types.js'

// ─── Minimal concrete subclass for testing ───────────────────────────────────

class TestAgent extends BaseAgent {
    processMessage(msg: AgentMessage): AgentMessage[] {
        return []
    }
    tick(): AgentMessage[] {
        return []
    }

    // Expose protected methods for testing
    publicLog(eventType: Parameters<BaseAgent['log']>[0], description: string, metadata?: Record<string, unknown>) {
        return this.log(eventType, description, metadata)
    }
    publicCreateTask(task: Task) {
        return this.createTask(task)
    }
    publicUpdateTask(id: string, patch: Partial<Task>) {
        return this.updateTask(id, patch)
    }
    publicEnqueueOutbound(msg: AgentMessage) {
        return this.enqueueOutbound(msg)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLockToken(resource: string, holder: AgentRole): LockToken {
    return { resource: resource as LockToken['resource'], holder, acquired_at: new Date().toISOString(), token_id: 'tok-1' }
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
        type: 'STATUS_UPDATE',
        payload: {},
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

    let locked = false
    const writeLockManager: WriteLockManager = {
        acquire: vi.fn((resource, role) => {
            locked = true
            return makeLockToken(resource, role)
        }),
        release: vi.fn(() => { locked = false }),
        isLocked: vi.fn(() => locked),
    }

    return { activityLog, taskBoard, writeLockManager }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BaseAgent', () => {
    let agent: TestAgent
    let mocks: ReturnType<typeof makeMocks>

    beforeEach(() => {
        mocks = makeMocks()
        agent = new TestAgent('CTO', mocks.activityLog, mocks.taskBoard, mocks.writeLockManager)
    })

    describe('role', () => {
        it('exposes the role passed to the constructor', () => {
            expect(agent.role).toBe('CTO')
        })
    })

    describe('initialize()', () => {
        it('can be called without throwing', () => {
            expect(() => agent.initialize()).not.toThrow()
        })
    })

    describe('getOutboundQueue()', () => {
        it('returns empty array when no messages enqueued', () => {
            expect(agent.getOutboundQueue()).toEqual([])
        })

        it('returns enqueued messages and clears the buffer', () => {
            const msg = makeMessage()
            agent.publicEnqueueOutbound(msg)
            const queue = agent.getOutboundQueue()
            expect(queue).toHaveLength(1)
            expect(queue[0]).toBe(msg)
            // Buffer is now cleared
            expect(agent.getOutboundQueue()).toHaveLength(0)
        })

        it('returns all enqueued messages in order', () => {
            const m1 = makeMessage({ id: 'a' })
            const m2 = makeMessage({ id: 'b' })
            const m3 = makeMessage({ id: 'c' })
            agent.publicEnqueueOutbound(m1)
            agent.publicEnqueueOutbound(m2)
            agent.publicEnqueueOutbound(m3)
            const queue = agent.getOutboundQueue()
            expect(queue.map(m => m.id)).toEqual(['a', 'b', 'c'])
        })
    })

    describe('log()', () => {
        it('acquires and releases the activity_log lock', () => {
            agent.publicLog('TASK_CREATED', 'something happened')
            expect(mocks.writeLockManager.acquire).toHaveBeenCalledWith('activity_log', 'CTO')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })

        it('appends an entry to the activity log with correct fields', () => {
            agent.publicLog('TASK_CREATED', 'task was created', { task_id: 'x' })
            expect(mocks.activityLog.append).toHaveBeenCalledWith(
                expect.objectContaining({
                    agent_role: 'CTO',
                    event_type: 'TASK_CREATED',
                    description: 'task was created',
                    metadata: { task_id: 'x' },
                })
            )
        })

        it('releases the lock even if append throws', () => {
            vi.mocked(mocks.activityLog.append).mockImplementationOnce(() => { throw new Error('append failed') })
            expect(() => agent.publicLog('TASK_CREATED', 'oops')).toThrow('append failed')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })
    })

    describe('createTask()', () => {
        it('acquires and releases the task_board lock', () => {
            agent.publicCreateTask(makeTask())
            expect(mocks.writeLockManager.acquire).toHaveBeenCalledWith('task_board', 'CTO')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })

        it('calls taskBoard.createTask with the provided task', () => {
            const task = makeTask()
            agent.publicCreateTask(task)
            expect(mocks.taskBoard.createTask).toHaveBeenCalledWith(task)
        })

        it('logs TASK_CREATED after creating the task', () => {
            agent.publicCreateTask(makeTask())
            // activity_log.append should have been called for TASK_CREATED
            const calls = vi.mocked(mocks.activityLog.append).mock.calls
            const taskCreatedCall = calls.find(([entry]) => entry.event_type === 'TASK_CREATED')
            expect(taskCreatedCall).toBeDefined()
        })

        it('releases the task_board lock even if createTask throws', () => {
            vi.mocked(mocks.taskBoard.createTask).mockImplementationOnce(() => { throw new Error('create failed') })
            expect(() => agent.publicCreateTask(makeTask())).toThrow('create failed')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })
    })

    describe('updateTask()', () => {
        it('acquires and releases the task_board lock', () => {
            agent.publicUpdateTask('task-1', { status: 'IN_PROGRESS' })
            expect(mocks.writeLockManager.acquire).toHaveBeenCalledWith('task_board', 'CTO')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })

        it('calls taskBoard.updateTask with the id and patch', () => {
            agent.publicUpdateTask('task-1', { status: 'IN_PROGRESS' })
            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', { status: 'IN_PROGRESS' })
        })

        it('logs TASK_STATE_CHANGED when status changes', () => {
            // getTask returns PENDING, updateTask returns IN_PROGRESS
            vi.mocked(mocks.taskBoard.getTask).mockReturnValueOnce(makeTask({ status: 'PENDING' }))
            vi.mocked(mocks.taskBoard.updateTask).mockReturnValueOnce(makeTask({ status: 'IN_PROGRESS' }))

            agent.publicUpdateTask('task-1', { status: 'IN_PROGRESS' })

            const calls = vi.mocked(mocks.activityLog.append).mock.calls
            const stateChangedCall = calls.find(([entry]) => entry.event_type === 'TASK_STATE_CHANGED')
            expect(stateChangedCall).toBeDefined()
        })

        it('does not log TASK_STATE_CHANGED when status is not in patch', () => {
            agent.publicUpdateTask('task-1', { title: 'New title' })
            const calls = vi.mocked(mocks.activityLog.append).mock.calls
            const stateChangedCall = calls.find(([entry]) => entry.event_type === 'TASK_STATE_CHANGED')
            expect(stateChangedCall).toBeUndefined()
        })

        it('releases the task_board lock even if updateTask throws', () => {
            vi.mocked(mocks.taskBoard.updateTask).mockImplementationOnce(() => { throw new Error('update failed') })
            expect(() => agent.publicUpdateTask('task-1', { status: 'IN_PROGRESS' })).toThrow('update failed')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })
    })
})
