import type { LedgerEntry } from '../types.js'
import type { BudgetLedger as IBudgetLedger } from '../interfaces.js'
import type { ActivityLog as IActivityLog } from '../interfaces.js'

const REQUIRED_FIELDS: (keyof LedgerEntry)[] = [
    'id', 'description', 'amount', 'type', 'agent_role', 'timestamp', 'sprint_id',
]

const DEFAULT_ALERT_THRESHOLD = 2000

export class BudgetLedger implements IBudgetLedger {
    private readonly _entries: LedgerEntry[] = []
    private readonly _activityLog: IActivityLog
    private readonly _alertThreshold: number

    constructor(activityLog: IActivityLog, alertThreshold: number = DEFAULT_ALERT_THRESHOLD) {
        this._activityLog = activityLog
        this._alertThreshold = alertThreshold
    }

    append(entry: LedgerEntry): LedgerEntry {
        // Validate required fields
        for (const field of REQUIRED_FIELDS) {
            const value = entry[field]
            if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
                throw new Error(`LedgerEntry missing required field: ${field}`)
            }
        }

        // amount must be positive
        if (entry.amount <= 0) {
            throw new Error(`LedgerEntry amount must be positive, got: ${entry.amount}`)
        }

        const currentBalance = this.getBalance()

        // Overdraft check
        if (entry.type === 'DEBIT' && entry.amount > currentBalance) {
            const msg = `Expense rejected: amount ${entry.amount} exceeds current balance ${currentBalance}`
            this._activityLog.append({
                id: `expense-rejected-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                timestamp: new Date().toISOString(),
                agent_role: entry.agent_role,
                event_type: 'EXPENSE_REJECTED',
                description: msg,
                metadata: { entry_id: entry.id, amount: entry.amount, balance: currentBalance },
            })
            throw new Error(msg)
        }

        // Compute running balance
        const runningBalance =
            entry.type === 'CREDIT'
                ? currentBalance + entry.amount
                : currentBalance - entry.amount

        const stored: LedgerEntry = { ...entry, running_balance: runningBalance }
        this._entries.push(stored)

        // Emit BUDGET_ALERT if balance falls below threshold
        if (runningBalance < this._alertThreshold) {
            this._activityLog.append({
                id: `budget-alert-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                timestamp: new Date().toISOString(),
                agent_role: entry.agent_role,
                event_type: 'BUDGET_ALERT',
                description: `Budget alert: running balance ${runningBalance} is below threshold ${this._alertThreshold}`,
                metadata: { running_balance: runningBalance, threshold: this._alertThreshold },
            })
        }

        return { ...stored }
    }

    getBalance(): number {
        if (this._entries.length === 0) return 0
        return this._entries[this._entries.length - 1].running_balance
    }

    getAll(): LedgerEntry[] {
        return [...this._entries]
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
            .map(e => ({ ...e }))
    }

    getEntriesSince(timestamp: string): LedgerEntry[] {
        return this._entries
            .filter(e => e.timestamp >= timestamp)
            .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
            .map(e => ({ ...e }))
    }
}
