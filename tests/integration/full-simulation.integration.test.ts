import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { COSOrchestrator } from '../../src/orchestrator.js'
import type { AgentMessage, Employee, LedgerEntry } from '../../src/types.js'
import type { MessageQueue } from '../../src/message-queue.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getQueues(orchestrator: COSOrchestrator): Map<string, MessageQueue> {
    return (orchestrator as any)._queues
}

function getBudgetLedger(orchestrator: COSOrchestrator) {
    return (orchestrator as any)._budgetLedger
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
    return {
        id: randomUUID(),
        name: 'Jane Doe',
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

function makeMsg(overrides: Partial<AgentMessage>): AgentMessage {
    return {
        id: randomUUID(),
        from: 'CEO',
        to: 'CEO',
        type: 'STATUS_UPDATE',
        payload: {},
        timestamp: new Date().toISOString(),
        ...overrides,
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Full Simulation Integration', () => {
    let orchestrator: COSOrchestrator

    beforeEach(() => {
        orchestrator = new COSOrchestrator()
        orchestrator.start()
    })

    /**
     * Requirement 3.1 — Hire approval flow
     * HR receives HIRE_REQUEST → sends APPROVAL_REQUEST to CEO (tick 1)
     * CEO approves → HR adds employee (tick 2)
     */
    it('hire approval flow: employee appears in registry after two ticks (Req 3.1)', () => {
        const queues = getQueues(orchestrator)
        const hrQueue = queues.get('HR')!
        const employee = makeEmployee()

        // Inject HIRE_REQUEST into HR queue
        hrQueue.enqueue(makeMsg({
            from: 'CEO',
            to: 'HR',
            type: 'HIRE_REQUEST',
            payload: { employeeData: employee },
        }))

        // Tick 1: HR processes HIRE_REQUEST → sends APPROVAL_REQUEST to CEO
        orchestrator.tick()

        // Tick 2: CEO processes APPROVAL_REQUEST → sends APPROVAL_RESPONSE to HR
        orchestrator.tick()

        // Tick 3: HR processes APPROVAL_RESPONSE → adds employee to registry
        orchestrator.tick()

        const registry = orchestrator.getEmployeeRegistry()
        const added = registry.find(e => e.id === employee.id)
        expect(added).toBeDefined()
        expect(added?.name).toBe(employee.name)
    })

    /**
     * Requirement 3.2 / 5.5 — Expense approval flow
     * Finance receives EXPENSE_REQUEST with amount > 500 and expenseData in payload.
     * Tick 1: Finance sends APPROVAL_REQUEST to CEO.
     * Tick 2: CEO approves → Finance commits ledger entry.
     */
    it('expense approval flow: ledger entry appears after two ticks (Req 3.2)', () => {
        const queues = getQueues(orchestrator)
        const financeQueue = queues.get('Finance')!
        const sprint = orchestrator.getCurrentSprint()

        // First credit the budget so the debit can succeed
        const ledger = getBudgetLedger(orchestrator)
        ledger.append({
            id: randomUUID(),
            description: 'Initial budget credit',
            amount: 5000,
            type: 'CREDIT',
            agent_role: 'Finance',
            timestamp: new Date().toISOString(),
            running_balance: 0,
            sprint_id: sprint.id,
        })

        const expenseData: LedgerEntry = {
            id: randomUUID(),
            description: 'Server infrastructure',
            amount: 1000,
            type: 'DEBIT',
            agent_role: 'Finance',
            timestamp: new Date().toISOString(),
            running_balance: 0,
            sprint_id: sprint.id,
        }

        // Inject EXPENSE_REQUEST with amount > 500 and expenseData for CEO approval flow
        financeQueue.enqueue(makeMsg({
            from: 'CEO',
            to: 'Finance',
            type: 'EXPENSE_REQUEST',
            payload: {
                amount: 1000,
                description: 'Server infrastructure',
                sprint_id: sprint.id,
                expenseData,
            },
        }))

        // Tick 1: Finance processes EXPENSE_REQUEST → sends APPROVAL_REQUEST to CEO
        orchestrator.tick()

        // Tick 2: CEO processes APPROVAL_REQUEST → sends APPROVAL_RESPONSE to Finance
        orchestrator.tick()

        // Tick 3: Finance processes APPROVAL_RESPONSE → commits ledger entry
        orchestrator.tick()

        const ledgerEntries = orchestrator.getBudgetLedger()
        const committed = ledgerEntries.find(e => e.id === expenseData.id)
        expect(committed).toBeDefined()
        expect(committed?.amount).toBe(1000)
    })

    /**
     * Requirement 5.5 — Overdraft rejection
     * Budget starts at 0 (no initial credit). An EXPENSE_REQUEST with amount: 100
     * should be rejected (no ledger entry, EXPENSE_REJECTED in activity log).
     */
    it('overdraft rejection: expense rejected when balance is 0 (Req 5.5)', () => {
        const queues = getQueues(orchestrator)
        const financeQueue = queues.get('Finance')!
        const sprint = orchestrator.getCurrentSprint()

        // Inject a small expense (≤ 500 so Finance commits directly without CEO approval)
        financeQueue.enqueue(makeMsg({
            from: 'CEO',
            to: 'Finance',
            type: 'EXPENSE_REQUEST',
            payload: {
                amount: 100,
                description: 'Office supplies',
                sprint_id: sprint.id,
            },
        }))

        orchestrator.tick()

        // No ledger entries should exist (balance was 0, overdraft rejected)
        const ledgerEntries = orchestrator.getBudgetLedger()
        expect(ledgerEntries).toHaveLength(0)

        // EXPENSE_REJECTED should appear in activity log
        const log = orchestrator.getActivityLog()
        const rejected = log.find(e => e.event_type === 'EXPENSE_REJECTED')
        expect(rejected).toBeDefined()
    })

    /**
     * Requirement 8.1 — Report generation
     * generateReport() should return all 7 sections and sprint_id matches active sprint.
     */
    it('report generation: all 7 sections present and sprint_id matches (Req 8.1)', () => {
        const sprint = orchestrator.getCurrentSprint()
        const report = orchestrator.generateReport()

        // All 7 required sections
        expect(report).toHaveProperty('task_board')
        expect(report).toHaveProperty('pending_approvals')
        expect(report).toHaveProperty('employee_registry')
        expect(report).toHaveProperty('budget_ledger')
        expect(report).toHaveProperty('department_updates')
        expect(report).toHaveProperty('activity_log')
        expect(report).toHaveProperty('alerts')

        // sprint_id matches active sprint
        expect(report.sprint_id).toBe(sprint.id)

        // generated_at is a valid ISO timestamp
        expect(() => new Date(report.generated_at)).not.toThrow()
        expect(new Date(report.generated_at).toISOString()).toBe(report.generated_at)
    })

    /**
     * Requirements 1.1, 9.2 — End-to-end state consistency
     * After multiple ticks, activity log has entries, sprint is ACTIVE,
     * and generateReport() produces a valid report.
     */
    it('end-to-end state consistency after multiple ticks (Req 1.1, 9.2)', () => {
        // Run several ticks
        orchestrator.tick()
        orchestrator.tick()
        orchestrator.tick()

        // Activity log should have entries
        const log = orchestrator.getActivityLog()
        expect(log.length).toBeGreaterThan(0)

        // Current sprint should be ACTIVE
        const sprint = orchestrator.getCurrentSprint()
        expect(sprint.status).toBe('ACTIVE')

        // generateReport() should produce a valid report
        const report = orchestrator.generateReport()
        expect(report.sprint_id).toBe(sprint.id)
        expect(report.generated_at).toBeTruthy()
        expect(Array.isArray(report.task_board)).toBe(true)
        expect(Array.isArray(report.activity_log)).toBe(true)
        expect(report.activity_log.length).toBeGreaterThan(0)
    })
})
