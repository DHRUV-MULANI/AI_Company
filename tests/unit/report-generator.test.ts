import { describe, it, expect, beforeEach } from 'vitest'
import { ReportGenerator } from '../../src/report-generator.js'
import { TaskBoard } from '../../src/stores/task-board.js'
import { BudgetLedger } from '../../src/stores/budget-ledger.js'
import { EmployeeRegistry } from '../../src/stores/employee-registry.js'
import { ActivityLog } from '../../src/stores/activity-log.js'
import type { Sprint, Task, LedgerEntry, Employee, PendingApproval, ActivityEntry } from '../../src/types.js'

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
        title: 'Test Task',
        owner: 'CEO',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
        sprint_id: 'sprint-1',
        ...overrides,
    }
}

function makeLedgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        id: 'entry-1',
        description: 'Initial credit',
        amount: 5000,
        type: 'CREDIT',
        agent_role: 'Finance',
        timestamp: '2024-01-01T00:00:00.000Z',
        running_balance: 5000,
        sprint_id: 'sprint-1',
        ...overrides,
    }
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
    return {
        id: 'emp-1',
        name: 'Alice',
        role: 'Engineer',
        department: 'Engineering',
        start_date: '2024-01-01',
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

function makeActivityEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
    return {
        id: 'act-1',
        timestamp: '2024-01-01T01:00:00.000Z',
        agent_role: 'CEO',
        event_type: 'TASK_CREATED',
        description: 'Task created',
        ...overrides,
    }
}

describe('ReportGenerator', () => {
    let activityLog: ActivityLog
    let taskBoard: TaskBoard
    let budgetLedger: BudgetLedger
    let employeeRegistry: EmployeeRegistry
    let pendingApprovals: PendingApproval[]
    let generator: ReportGenerator

    beforeEach(() => {
        activityLog = new ActivityLog()
        taskBoard = new TaskBoard(activityLog)
        budgetLedger = new BudgetLedger(activityLog)
        employeeRegistry = new EmployeeRegistry()
        pendingApprovals = []
        generator = new ReportGenerator(taskBoard, budgetLedger, employeeRegistry, activityLog, pendingApprovals)
    })

    describe('generate', () => {
        it('returns a report with generated_at and sprint_id', () => {
            const sprint = makeSprint()
            const before = new Date().toISOString()
            const report = generator.generate(sprint)
            const after = new Date().toISOString()

            expect(report.sprint_id).toBe('sprint-1')
            expect(report.generated_at >= before).toBe(true)
            expect(report.generated_at <= after).toBe(true)
        })

        it('populates all 7 required sections', () => {
            const sprint = makeSprint()
            const report = generator.generate(sprint)

            expect(report).toHaveProperty('task_board')
            expect(report).toHaveProperty('pending_approvals')
            expect(report).toHaveProperty('employee_registry')
            expect(report).toHaveProperty('budget_ledger')
            expect(report).toHaveProperty('department_updates')
            expect(report).toHaveProperty('activity_log')
            expect(report).toHaveProperty('alerts')
        })

        it('task_board contains all tasks from TaskBoard', () => {
            taskBoard.createTask(makeTask({ id: 'task-1', title: 'Task One' }))
            taskBoard.createTask(makeTask({ id: 'task-2', title: 'Task Two', owner: 'CTO' }))

            const report = generator.generate(makeSprint())

            expect(report.task_board).toHaveLength(2)
            const ids = report.task_board.map(t => t.id)
            expect(ids).toContain('task-1')
            expect(ids).toContain('task-2')
        })

        it('employee_registry contains all employees', () => {
            employeeRegistry.addEmployee(makeEmployee({ id: 'emp-1', name: 'Alice' }))
            employeeRegistry.addEmployee(makeEmployee({ id: 'emp-2', name: 'Bob' }))

            const report = generator.generate(makeSprint())

            expect(report.employee_registry).toHaveLength(2)
            const names = report.employee_registry.map(e => e.name)
            expect(names).toContain('Alice')
            expect(names).toContain('Bob')
        })

        it('budget_ledger contains all ledger entries', () => {
            budgetLedger.append(makeLedgerEntry({ id: 'entry-1', amount: 5000, type: 'CREDIT', running_balance: 5000 }))

            const report = generator.generate(makeSprint())

            expect(report.budget_ledger).toHaveLength(1)
            expect(report.budget_ledger[0].id).toBe('entry-1')
        })

        it('activity_log contains all activity entries', () => {
            activityLog.append(makeActivityEntry({ id: 'act-1' }))
            activityLog.append(makeActivityEntry({ id: 'act-2', event_type: 'TASK_STATE_CHANGED', description: 'State changed' }))

            const report = generator.generate(makeSprint())

            const ids = report.activity_log.map(e => e.id)
            expect(ids).toContain('act-1')
            expect(ids).toContain('act-2')
        })

        it('pending_approvals reflects the passed-in approvals', () => {
            const approval: PendingApproval = {
                task_id: 'task-1',
                request_type: 'HIRE',
                requested_by: 'HR',
                requested_at: '2024-01-01T00:00:00.000Z',
                payload: { name: 'Charlie' },
            }
            pendingApprovals.push(approval)

            const report = generator.generate(makeSprint())

            expect(report.pending_approvals).toHaveLength(1)
            expect(report.pending_approvals[0].task_id).toBe('task-1')
        })

        it('department_updates has one entry per AgentRole (6 total)', () => {
            const report = generator.generate(makeSprint())

            expect(report.department_updates).toHaveLength(6)
            const roles = report.department_updates.map(d => d.agent_role)
            expect(roles).toContain('CEO')
            expect(roles).toContain('CTO')
            expect(roles).toContain('HR')
            expect(roles).toContain('Finance')
            expect(roles).toContain('Operations')
            expect(roles).toContain('Marketing')
        })

        it('department_updates correctly counts task statuses per role', () => {
            taskBoard.createTask(makeTask({ id: 't1', owner: 'CTO', status: 'COMPLETED' }))
            taskBoard.createTask(makeTask({ id: 't2', owner: 'CTO', status: 'IN_PROGRESS' }))
            taskBoard.createTask(makeTask({ id: 't3', owner: 'CTO', status: 'BLOCKED' }))

            const report = generator.generate(makeSprint())

            const ctoUpdate = report.department_updates.find(d => d.agent_role === 'CTO')!
            expect(ctoUpdate.tasks_completed).toBe(1)
            expect(ctoUpdate.tasks_in_progress).toBe(1)
            expect(ctoUpdate.tasks_blocked).toBe(1)
        })

        it('alerts are derived from BUDGET_ALERT activity entries', () => {
            activityLog.append(makeActivityEntry({
                id: 'alert-1',
                event_type: 'BUDGET_ALERT',
                description: 'Budget low',
            }))

            const report = generator.generate(makeSprint())

            const alert = report.alerts.find(a => a.id === 'alert-1')
            expect(alert).toBeDefined()
            expect(alert!.type).toBe('LOW_BUDGET')
            expect(alert!.severity).toBe('CRITICAL')
        })

        it('alerts are derived from BUDGET_WARNING activity entries', () => {
            activityLog.append(makeActivityEntry({
                id: 'warn-1',
                event_type: 'BUDGET_WARNING',
                description: 'Budget warning',
            }))

            const report = generator.generate(makeSprint())

            const alert = report.alerts.find(a => a.id === 'warn-1')
            expect(alert).toBeDefined()
            expect(alert!.type).toBe('BUDGET_WARNING')
            expect(alert!.severity).toBe('WARNING')
        })

        it('alerts are derived from TASK_BLOCKED activity entries', () => {
            activityLog.append(makeActivityEntry({
                id: 'blocked-1',
                event_type: 'TASK_BLOCKED',
                description: 'Task is blocked',
            }))

            const report = generator.generate(makeSprint())

            const alert = report.alerts.find(a => a.id === 'blocked-1')
            expect(alert).toBeDefined()
            expect(alert!.type).toBe('TASK_BLOCKED')
            expect(alert!.severity).toBe('WARNING')
        })

        it('non-alert activity entries do not produce alerts', () => {
            activityLog.append(makeActivityEntry({ id: 'act-1', event_type: 'TASK_CREATED', description: 'Task created' }))

            const report = generator.generate(makeSprint())

            expect(report.alerts).toHaveLength(0)
        })

        it('generates report with known full state across all sections', () => {
            taskBoard.createTask(makeTask({ id: 'task-1', owner: 'HR', status: 'COMPLETED' }))
            employeeRegistry.addEmployee(makeEmployee({ id: 'emp-1' }))
            budgetLedger.append(makeLedgerEntry({ id: 'entry-1', amount: 5000, type: 'CREDIT', running_balance: 5000 }))
            activityLog.append(makeActivityEntry({ id: 'act-1' }))
            pendingApprovals.push({
                task_id: 'task-1',
                request_type: 'EXPENSE',
                requested_by: 'Finance',
                requested_at: '2024-01-01T00:00:00.000Z',
                payload: {},
            })

            const sprint = makeSprint({ id: 'sprint-42' })
            const report = generator.generate(sprint)

            expect(report.sprint_id).toBe('sprint-42')
            expect(report.task_board).toHaveLength(1)
            expect(report.employee_registry).toHaveLength(1)
            expect(report.budget_ledger).toHaveLength(1)
            expect(report.activity_log.some(e => e.id === 'act-1')).toBe(true)
            expect(report.pending_approvals).toHaveLength(1)
            expect(report.department_updates).toHaveLength(6)
        })
    })

    describe('serialize / deserialize', () => {
        it('serialize returns a JSON string', () => {
            const report = generator.generate(makeSprint())
            const json = generator.serialize(report)
            expect(typeof json).toBe('string')
            expect(() => JSON.parse(json)).not.toThrow()
        })

        it('deserialize round-trip preserves all fields', () => {
            taskBoard.createTask(makeTask({ id: 'task-1' }))
            employeeRegistry.addEmployee(makeEmployee({ id: 'emp-1' }))
            budgetLedger.append(makeLedgerEntry({ id: 'entry-1', amount: 5000, type: 'CREDIT', running_balance: 5000 }))
            activityLog.append(makeActivityEntry({ id: 'act-1' }))

            const original = generator.generate(makeSprint())
            const json = generator.serialize(original)
            const restored = generator.deserialize(json)

            expect(restored.sprint_id).toBe(original.sprint_id)
            expect(restored.generated_at).toBe(original.generated_at)
            expect(restored.task_board).toEqual(original.task_board)
            expect(restored.employee_registry).toEqual(original.employee_registry)
            expect(restored.budget_ledger).toEqual(original.budget_ledger)
            expect(restored.activity_log).toEqual(original.activity_log)
            expect(restored.pending_approvals).toEqual(original.pending_approvals)
            expect(restored.department_updates).toEqual(original.department_updates)
            expect(restored.alerts).toEqual(original.alerts)
        })

        it('serialize/deserialize round-trip on empty state', () => {
            const original = generator.generate(makeSprint())
            const restored = generator.deserialize(generator.serialize(original))

            expect(restored).toEqual(original)
        })
    })
})
