import { randomUUID } from 'crypto'
import { BaseAgent } from './base-agent.js'
import type { AgentMessage, LedgerEntry } from '../types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../interfaces.js'
import { BudgetLedger } from '../stores/budget-ledger.js'

/**
 * Finance Agent — manages expenses and budget approvals.
 *
 * Requirements: 3.2, 5.3, 5.4, 5.5, 10.1
 */
export class FinanceAgent extends BaseAgent {
    private readonly _taskBoardRef: TaskBoard
    private readonly _budgetLedger: BudgetLedger
    private readonly _lockManager: WriteLockManager

    constructor(
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
        budgetLedger: BudgetLedger,
    ) {
        super('Finance', activityLog, taskBoard, writeLockManager)
        this._taskBoardRef = taskBoard
        this._budgetLedger = budgetLedger
        this._lockManager = writeLockManager
    }

    processMessage(msg: AgentMessage): AgentMessage[] {
        const outbound: AgentMessage[] = []

        if (msg.type === 'EXPENSE_REQUEST') {
            const amount = msg.payload.amount as number

            if (amount <= 500) {
                // Commit directly
                const token = this._lockManager.acquire('budget_ledger', 'Finance')
                try {
                    const entry: LedgerEntry = {
                        id: randomUUID(),
                        description: (msg.payload.description as string) ?? 'Expense',
                        amount,
                        type: 'DEBIT',
                        agent_role: 'Finance',
                        timestamp: new Date().toISOString(),
                        running_balance: 0, // will be computed by ledger
                        sprint_id: (msg.payload.sprint_id as string) ?? '',
                    }
                    this._budgetLedger.append(entry)
                } catch {
                    // Overdraft or validation error — already logged by BudgetLedger
                    return outbound
                } finally {
                    this._lockManager.release(token)
                }

                this.log('EXPENSE_COMMITTED', `Expense committed: ${amount}`, {
                    amount,
                    message_id: msg.id,
                })
            } else {
                // Requires CEO approval
                const approvalRequest: AgentMessage = {
                    id: randomUUID(),
                    from: 'Finance',
                    to: 'CEO',
                    type: 'APPROVAL_REQUEST',
                    payload: { ...msg.payload, originalMessageId: msg.id },
                    timestamp: new Date().toISOString(),
                    correlationId: msg.id,
                }
                this.enqueueOutbound(approvalRequest)
                outbound.push(approvalRequest)

                if (msg.payload.task_id) {
                    this.updateTask(msg.payload.task_id as string, { status: 'PENDING' })
                }

                this.log('APPROVAL_REQUESTED', `Expense approval requested from CEO for amount: ${amount}`, {
                    amount,
                    message_id: msg.id,
                })
            }
        } else if (msg.type === 'APPROVAL_RESPONSE') {
            if (msg.payload.approved === true) {
                const expenseData = msg.payload.expenseData as LedgerEntry | undefined
                if (expenseData) {
                    const token = this._lockManager.acquire('budget_ledger', 'Finance')
                    try {
                        this._budgetLedger.append(expenseData)
                    } finally {
                        this._lockManager.release(token)
                    }

                    this.log('EXPENSE_COMMITTED', `Approved expense committed: ${expenseData.amount}`, {
                        entry_id: expenseData.id,
                        amount: expenseData.amount,
                    })
                }

                if (msg.payload.task_id) {
                    this.updateTask(msg.payload.task_id as string, { status: 'IN_PROGRESS' })
                }
            } else {
                if (msg.payload.task_id) {
                    this.updateTask(msg.payload.task_id as string, {
                        status: 'BLOCKED',
                        blocker_reason: (msg.payload.reason as string) ?? 'Expense rejected by CEO',
                    })
                }
            }
        }

        return outbound
    }

    tick(): AgentMessage[] {
        return []
    }
}
