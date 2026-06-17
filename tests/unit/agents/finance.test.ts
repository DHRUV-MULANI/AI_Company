import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FinanceAgent } from '../../../src/agents/finance-agent.js'
import type { AgentMessage, Task, LedgerEntry, LockToken } from '../../../src/types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../../../src/interfaces.js'
import { BudgetLedger } from '../../../src/stores/budget-ledger.js'

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
        owner: 'Finance',
        status: 'PENDING',
        priority: 'MEDIUM',
        sprint_id: 'sprint-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    }
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        id: 'entry-1',
        description: 'Test expense',
        amount: 100,
        type: 'DEBIT',
        agent_role: 'Finance',
        timestamp: new Date().toISOString(),
        running_balance: 0,
        sprint_id: 'sprint-1',
        ...overrides,
    }
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
    return {
        id: 'msg-1',
        from: 'CEO',
        to: 'Finance',
        type: 'EXPENSE_REQUEST',
        payload: { amount: 100, description: 'Office supplies', sprint_id: 'sprint-1' },
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

    const budgetLedger = {
        append: vi.fn(entry => ({ ...entry, running_balance: 1000 })),
        getBalance: vi.fn(() => 5000),
        getAll: vi.fn(() => []),
        getEntriesSince: vi.fn(() => []),
    } as unknown as BudgetLedger

    return { activityLog, taskBoard, writeLockManager, budgetLedger }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FinanceAgent', () => {
    let agent: FinanceAgent
    let mocks: ReturnType<typeof makeMocks>

    beforeEach(() => {
        mocks = makeMocks()
        agent = new FinanceAgent(
            mocks.activityLog,
            mocks.taskBoard,
            mocks.writeLockManager,
            mocks.budgetLedger,
        )
    })

    describe('constructor', () => {
        it('sets role to Finance', () => {
            expect(agent.role).toBe('Finance')
        })
    })

    // ─── EXPENSE_REQUEST <= 500 ───────────────────────────────────────────────

    describe('processMessage() — EXPENSE_REQUEST <= 500', () => {
        it('commits expense directly without approval', () => {
            const msg = makeMessage({ payload: { amount: 500, description: 'Supplies', sprint_id: 'sprint-1' } })
            agent.processMessage(msg)

            expect(mocks.budgetLedger.append).toHaveBeenCalled()
        })

        it('logs EXPENSE_COMMITTED', () => {
            const msg = makeMessage({ payload: { amount: 100, description: 'Supplies', sprint_id: 'sprint-1' } })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'EXPENSE_COMMITTED')
            expect(entry).toBeDefined()
        })

        it('acquires and releases budget_ledger lock', () => {
            const msg = makeMessage({ payload: { amount: 200, description: 'Supplies', sprint_id: 'sprint-1' } })
            agent.processMessage(msg)

            expect(mocks.writeLockManager.acquire).toHaveBeenCalledWith('budget_ledger', 'Finance')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })

        it('returns empty outbound array for small expenses', () => {
            const msg = makeMessage({ payload: { amount: 50, description: 'Coffee', sprint_id: 'sprint-1' } })
            const outbound = agent.processMessage(msg)
            expect(outbound).toEqual([])
        })
    })

    // ─── EXPENSE_REQUEST > 500 ────────────────────────────────────────────────

    describe('processMessage() — EXPENSE_REQUEST > 500', () => {
        it('sends APPROVAL_REQUEST to CEO for large expenses', () => {
            const msg = makeMessage({ payload: { amount: 501, description: 'Server', sprint_id: 'sprint-1' } })
            const outbound = agent.processMessage(msg)

            expect(outbound).toHaveLength(1)
            expect(outbound[0].type).toBe('APPROVAL_REQUEST')
            expect(outbound[0].to).toBe('CEO')
            expect(outbound[0].from).toBe('Finance')
        })

        it('logs APPROVAL_REQUESTED for large expenses', () => {
            const msg = makeMessage({ payload: { amount: 1000, description: 'Server', sprint_id: 'sprint-1' } })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'APPROVAL_REQUESTED')
            expect(entry).toBeDefined()
        })

        it('holds task in PENDING for large expenses', () => {
            const msg = makeMessage({
                payload: { amount: 1000, description: 'Server', sprint_id: 'sprint-1', task_id: 'task-99' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-99', { status: 'PENDING' })
        })

        it('does not commit expense directly for large amounts', () => {
            const msg = makeMessage({ payload: { amount: 999, description: 'Server', sprint_id: 'sprint-1' } })
            agent.processMessage(msg)

            expect(mocks.budgetLedger.append).not.toHaveBeenCalled()
        })
    })

    // ─── APPROVAL_RESPONSE approved ───────────────────────────────────────────

    describe('processMessage() — APPROVAL_RESPONSE approved', () => {
        it('commits the pending expense when approved', () => {
            const expenseData = makeLedgerEntry({ amount: 1000 })
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, expenseData, task_id: 'task-1' },
            })
            agent.processMessage(msg)

            expect(mocks.budgetLedger.append).toHaveBeenCalledWith(expenseData)
        })

        it('logs EXPENSE_COMMITTED when approved', () => {
            const expenseData = makeLedgerEntry({ amount: 1000 })
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, expenseData },
            })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'EXPENSE_COMMITTED')
            expect(entry).toBeDefined()
        })
    })

    // ─── APPROVAL_RESPONSE rejected ───────────────────────────────────────────

    describe('processMessage() — APPROVAL_RESPONSE rejected', () => {
        it('blocks the task when rejected', () => {
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: false, task_id: 'task-1' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', {
                status: 'BLOCKED',
                blocker_reason: 'Expense rejected by CEO',
            })
        })

        it('uses provided reason when rejected with reason', () => {
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: false, task_id: 'task-1', reason: 'Over budget' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', {
                status: 'BLOCKED',
                blocker_reason: 'Over budget',
            })
        })
    })

    // ─── tick() ───────────────────────────────────────────────────────────────

    describe('tick()', () => {
        it('returns an empty array', () => {
            expect(agent.tick()).toEqual([])
        })
    })
})
