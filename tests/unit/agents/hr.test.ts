import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HRAgent } from '../../../src/agents/hr-agent.js'
import type { AgentMessage, Task, Employee, LockToken } from '../../../src/types.js'
import type { ActivityLog, TaskBoard, WriteLockManager, EmployeeRegistry } from '../../../src/interfaces.js'

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
        owner: 'HR',
        status: 'PENDING',
        priority: 'MEDIUM',
        sprint_id: 'sprint-1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    }
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
    return {
        id: 'emp-1',
        name: 'Alice',
        role: 'Engineer',
        department: 'Engineering',
        start_date: new Date().toISOString(),
        onboarding_status: 'IN_PROGRESS',
        onboarding_checklist: [
            { step: 'equipment_setup', completed: false },
            { step: 'system_access', completed: false },
            { step: 'orientation', completed: false },
            { step: 'role_briefing', completed: false },
        ],
        ...overrides,
    }
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
    return {
        id: 'msg-1',
        from: 'CEO',
        to: 'HR',
        type: 'HIRE_REQUEST',
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

    const employeeRegistry: EmployeeRegistry = {
        addEmployee: vi.fn(emp => emp),
        updateEmployee: vi.fn((id, patch) => ({ ...makeEmployee(), ...patch, id })),
        getEmployee: vi.fn(() => null),
        getAllEmployees: vi.fn(() => []),
    }

    return { activityLog, taskBoard, writeLockManager, employeeRegistry }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HRAgent', () => {
    let agent: HRAgent
    let mocks: ReturnType<typeof makeMocks>

    beforeEach(() => {
        mocks = makeMocks()
        agent = new HRAgent(
            mocks.activityLog,
            mocks.taskBoard,
            mocks.writeLockManager,
            mocks.employeeRegistry,
        )
    })

    describe('constructor', () => {
        it('sets role to HR', () => {
            expect(agent.role).toBe('HR')
        })
    })

    // ─── HIRE_REQUEST handling ────────────────────────────────────────────────

    describe('processMessage() — HIRE_REQUEST', () => {
        it('returns an APPROVAL_REQUEST message to CEO', () => {
            const msg = makeMessage({ type: 'HIRE_REQUEST' })
            const outbound = agent.processMessage(msg)

            expect(outbound).toHaveLength(1)
            expect(outbound[0].type).toBe('APPROVAL_REQUEST')
            expect(outbound[0].to).toBe('CEO')
            expect(outbound[0].from).toBe('HR')
        })

        it('enqueues the approval request in the outbound buffer', () => {
            const msg = makeMessage({ type: 'HIRE_REQUEST' })
            agent.processMessage(msg)

            const buffered = agent.getOutboundQueue()
            expect(buffered).toHaveLength(1)
            expect(buffered[0].type).toBe('APPROVAL_REQUEST')
        })

        it('logs APPROVAL_REQUESTED', () => {
            const msg = makeMessage({ type: 'HIRE_REQUEST' })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'APPROVAL_REQUESTED')
            expect(entry).toBeDefined()
        })

        it('holds associated task in PENDING', () => {
            const msg = makeMessage({ type: 'HIRE_REQUEST', payload: { task_id: 'task-42' } })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-42', { status: 'PENDING' })
        })
    })

    // ─── APPROVAL_RESPONSE approved ───────────────────────────────────────────

    describe('processMessage() — APPROVAL_RESPONSE approved', () => {
        it('adds employee to registry when approved', () => {
            const employee = makeEmployee()
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, employeeData: employee, task_id: 'task-1' },
            })
            agent.processMessage(msg)

            expect(mocks.employeeRegistry.addEmployee).toHaveBeenCalledWith(employee)
        })

        it('logs EMPLOYEE_ADDED', () => {
            const employee = makeEmployee()
            vi.mocked(mocks.employeeRegistry.addEmployee).mockReturnValue(employee)

            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, employeeData: employee },
            })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'EMPLOYEE_ADDED')
            expect(entry).toBeDefined()
        })

        it('logs ONBOARDING_COMPLETED when all checklist items are done', () => {
            const employee = makeEmployee({
                onboarding_checklist: [
                    { step: 'equipment_setup', completed: true },
                    { step: 'system_access', completed: true },
                    { step: 'orientation', completed: true },
                    { step: 'role_briefing', completed: true },
                ],
            })
            vi.mocked(mocks.employeeRegistry.addEmployee).mockReturnValue(employee)

            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, employeeData: employee },
            })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'ONBOARDING_COMPLETED')
            expect(entry).toBeDefined()
        })

        it('does not log ONBOARDING_COMPLETED when checklist is incomplete', () => {
            const employee = makeEmployee()
            vi.mocked(mocks.employeeRegistry.addEmployee).mockReturnValue(employee)

            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, employeeData: employee },
            })
            agent.processMessage(msg)

            const appendCalls = vi.mocked(mocks.activityLog.append).mock.calls
            const entry = appendCalls.find(([e]) => e.event_type === 'ONBOARDING_COMPLETED')
            expect(entry).toBeUndefined()
        })

        it('acquires and releases employee_registry lock', () => {
            const employee = makeEmployee()
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: true, employeeData: employee },
            })
            agent.processMessage(msg)

            expect(mocks.writeLockManager.acquire).toHaveBeenCalledWith('employee_registry', 'HR')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })
    })

    // ─── APPROVAL_RESPONSE rejected ───────────────────────────────────────────

    describe('processMessage() — APPROVAL_RESPONSE rejected', () => {
        it('blocks the task with default reason when rejected', () => {
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: false, task_id: 'task-1' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', {
                status: 'BLOCKED',
                blocker_reason: 'Hire rejected by CEO',
            })
        })

        it('uses provided reason when rejected with reason', () => {
            const msg = makeMessage({
                type: 'APPROVAL_RESPONSE',
                payload: { approved: false, task_id: 'task-1', reason: 'Budget freeze' },
            })
            agent.processMessage(msg)

            expect(mocks.taskBoard.updateTask).toHaveBeenCalledWith('task-1', {
                status: 'BLOCKED',
                blocker_reason: 'Budget freeze',
            })
        })
    })

    // ─── tick() ───────────────────────────────────────────────────────────────

    describe('tick()', () => {
        it('returns an empty array', () => {
            vi.mocked(mocks.employeeRegistry.getAllEmployees).mockReturnValue([])
            expect(agent.tick()).toEqual([])
        })

        it('marks one incomplete checklist item as complete for IN_PROGRESS employees', () => {
            const employee = makeEmployee()
            vi.mocked(mocks.employeeRegistry.getAllEmployees).mockReturnValue([employee])

            agent.tick()

            expect(mocks.employeeRegistry.updateEmployee).toHaveBeenCalledWith(
                'emp-1',
                expect.objectContaining({
                    onboarding_checklist: expect.arrayContaining([
                        expect.objectContaining({ step: 'equipment_setup', completed: true }),
                    ]),
                }),
            )
        })

        it('does not update employees with COMPLETED onboarding', () => {
            const employee = makeEmployee({ onboarding_status: 'COMPLETED' })
            vi.mocked(mocks.employeeRegistry.getAllEmployees).mockReturnValue([employee])

            agent.tick()

            expect(mocks.employeeRegistry.updateEmployee).not.toHaveBeenCalled()
        })

        it('acquires and releases employee_registry lock during tick', () => {
            const employee = makeEmployee()
            vi.mocked(mocks.employeeRegistry.getAllEmployees).mockReturnValue([employee])

            agent.tick()

            expect(mocks.writeLockManager.acquire).toHaveBeenCalledWith('employee_registry', 'HR')
            expect(mocks.writeLockManager.release).toHaveBeenCalled()
        })
    })
})
