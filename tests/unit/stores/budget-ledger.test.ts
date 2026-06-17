import { describe, it, expect, beforeEach } from 'vitest'
import { BudgetLedger } from '../../../src/stores/budget-ledger.js'
import { ActivityLog } from '../../../src/stores/activity-log.js'
import type { LedgerEntry } from '../../../src/types.js'

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
    return {
        id: 'entry-1',
        description: 'Test entry',
        amount: 100,
        type: 'CREDIT',
        agent_role: 'Finance',
        timestamp: '2024-01-01T00:00:00.000Z',
        running_balance: 0, // will be overwritten by append
        sprint_id: 'sprint-1',
        ...overrides,
    }
}

describe('BudgetLedger', () => {
    let activityLog: ActivityLog
    let ledger: BudgetLedger

    beforeEach(() => {
        activityLog = new ActivityLog()
        ledger = new BudgetLedger(activityLog)
    })

    // ─── append: credit ────────────────────────────────────────────────────────

    describe('CREDIT entries', () => {
        it('returns the appended entry with computed running_balance', () => {
            const result = ledger.append(makeEntry({ amount: 500, type: 'CREDIT' }))
            expect(result.running_balance).toBe(500)
        })

        it('accumulates balance across multiple credits', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 300, type: 'CREDIT' }))
            const result = ledger.append(makeEntry({ id: 'e2', amount: 200, type: 'CREDIT' }))
            expect(result.running_balance).toBe(500)
            expect(ledger.getBalance()).toBe(500)
        })
    })

    // ─── append: debit ─────────────────────────────────────────────────────────

    describe('DEBIT entries', () => {
        it('subtracts from balance on debit', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 1000, type: 'CREDIT' }))
            const result = ledger.append(makeEntry({ id: 'e2', amount: 400, type: 'DEBIT' }))
            expect(result.running_balance).toBe(600)
            expect(ledger.getBalance()).toBe(600)
        })

        it('allows debit that exactly equals the balance', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 500, type: 'CREDIT' }))
            const result = ledger.append(makeEntry({ id: 'e2', amount: 500, type: 'DEBIT' }))
            expect(result.running_balance).toBe(0)
        })
    })

    // ─── running balance math ──────────────────────────────────────────────────

    describe('running balance math', () => {
        it('each entry has the correct cumulative running_balance', () => {
            const e1 = ledger.append(makeEntry({ id: 'e1', amount: 1000, type: 'CREDIT', timestamp: '2024-01-01T00:00:00.000Z' }))
            const e2 = ledger.append(makeEntry({ id: 'e2', amount: 300, type: 'DEBIT', timestamp: '2024-01-02T00:00:00.000Z' }))
            const e3 = ledger.append(makeEntry({ id: 'e3', amount: 200, type: 'CREDIT', timestamp: '2024-01-03T00:00:00.000Z' }))
            const e4 = ledger.append(makeEntry({ id: 'e4', amount: 100, type: 'DEBIT', timestamp: '2024-01-04T00:00:00.000Z' }))

            expect(e1.running_balance).toBe(1000)
            expect(e2.running_balance).toBe(700)
            expect(e3.running_balance).toBe(900)
            expect(e4.running_balance).toBe(800)
        })

        it('getBalance returns 0 when ledger is empty', () => {
            expect(ledger.getBalance()).toBe(0)
        })

        it('getBalance reflects the latest running_balance', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 500, type: 'CREDIT' }))
            ledger.append(makeEntry({ id: 'e2', amount: 100, type: 'DEBIT' }))
            expect(ledger.getBalance()).toBe(400)
        })
    })

    // ─── overdraft rejection ───────────────────────────────────────────────────

    describe('overdraft rejection', () => {
        it('throws when debit amount exceeds current balance', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 100, type: 'CREDIT' }))
            expect(() =>
                ledger.append(makeEntry({ id: 'e2', amount: 200, type: 'DEBIT' }))
            ).toThrow(/exceeds current balance/)
        })

        it('does not append the entry when overdraft is rejected', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 100, type: 'CREDIT' }))
            try {
                ledger.append(makeEntry({ id: 'e2', amount: 200, type: 'DEBIT' }))
            } catch { /* expected */ }
            expect(ledger.getAll()).toHaveLength(1)
            expect(ledger.getBalance()).toBe(100)
        })

        it('logs EXPENSE_REJECTED to ActivityLog on overdraft', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 100, type: 'CREDIT' }))
            try {
                ledger.append(makeEntry({ id: 'e2', amount: 200, type: 'DEBIT' }))
            } catch { /* expected */ }
            const logs = activityLog.getAll()
            expect(logs.some(e => e.event_type === 'EXPENSE_REJECTED')).toBe(true)
        })

        it('throws when debit on empty ledger (balance is 0)', () => {
            expect(() =>
                ledger.append(makeEntry({ id: 'e1', amount: 50, type: 'DEBIT' }))
            ).toThrow()
        })
    })

    // ─── alert threshold ───────────────────────────────────────────────────────

    describe('BUDGET_ALERT threshold', () => {
        it('emits BUDGET_ALERT when balance falls below default threshold (2000)', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 3000, type: 'CREDIT' }))
            ledger.append(makeEntry({ id: 'e2', amount: 1500, type: 'DEBIT' }))
            // balance is now 1500, below 2000
            const logs = activityLog.getAll()
            expect(logs.some(e => e.event_type === 'BUDGET_ALERT')).toBe(true)
        })

        it('does not emit BUDGET_ALERT when balance stays at or above threshold', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 5000, type: 'CREDIT' }))
            ledger.append(makeEntry({ id: 'e2', amount: 500, type: 'DEBIT' }))
            // balance is 4500, above 2000
            const logs = activityLog.getAll()
            expect(logs.some(e => e.event_type === 'BUDGET_ALERT')).toBe(false)
        })

        it('respects a custom alert threshold', () => {
            const customLedger = new BudgetLedger(activityLog, 5000)
            customLedger.append(makeEntry({ id: 'e1', amount: 10000, type: 'CREDIT' }))
            customLedger.append(makeEntry({ id: 'e2', amount: 6000, type: 'DEBIT' }))
            // balance is 4000, below custom threshold of 5000
            const logs = activityLog.getAll()
            expect(logs.some(e => e.event_type === 'BUDGET_ALERT')).toBe(true)
        })

        it('does not emit alert when balance equals threshold exactly', () => {
            const customLedger = new BudgetLedger(activityLog, 1000)
            customLedger.append(makeEntry({ id: 'e1', amount: 2000, type: 'CREDIT' }))
            customLedger.append(makeEntry({ id: 'e2', amount: 1000, type: 'DEBIT' }))
            // balance is exactly 1000, not below threshold
            const logs = activityLog.getAll()
            expect(logs.some(e => e.event_type === 'BUDGET_ALERT')).toBe(false)
        })
    })

    // ─── getEntriesSince ───────────────────────────────────────────────────────

    describe('getEntriesSince', () => {
        beforeEach(() => {
            ledger.append(makeEntry({ id: 'e1', amount: 100, type: 'CREDIT', timestamp: '2024-01-01T00:00:00.000Z' }))
            ledger.append(makeEntry({ id: 'e2', amount: 50, type: 'DEBIT', timestamp: '2024-01-02T00:00:00.000Z' }))
            ledger.append(makeEntry({ id: 'e3', amount: 200, type: 'CREDIT', timestamp: '2024-01-03T00:00:00.000Z' }))
        })

        it('returns entries with timestamp >= given timestamp', () => {
            const result = ledger.getEntriesSince('2024-01-02T00:00:00.000Z')
            expect(result.map(e => e.id)).toEqual(['e2', 'e3'])
        })

        it('includes the entry exactly at the boundary timestamp', () => {
            const result = ledger.getEntriesSince('2024-01-01T00:00:00.000Z')
            expect(result).toHaveLength(3)
        })

        it('returns empty array when no entries match', () => {
            const result = ledger.getEntriesSince('2025-01-01T00:00:00.000Z')
            expect(result).toEqual([])
        })

        it('returns results sorted by timestamp ascending', () => {
            const result = ledger.getEntriesSince('2024-01-01T00:00:00.000Z')
            const timestamps = result.map(e => e.timestamp)
            expect(timestamps).toEqual([...timestamps].sort())
        })
    })

    // ─── chronological ordering ────────────────────────────────────────────────

    describe('getAll ordering', () => {
        it('returns entries sorted by timestamp ascending regardless of insertion order', () => {
            ledger.append(makeEntry({ id: 'e3', amount: 100, type: 'CREDIT', timestamp: '2024-01-03T00:00:00.000Z' }))
            ledger.append(makeEntry({ id: 'e1', amount: 200, type: 'CREDIT', timestamp: '2024-01-01T00:00:00.000Z' }))
            ledger.append(makeEntry({ id: 'e2', amount: 50, type: 'CREDIT', timestamp: '2024-01-02T00:00:00.000Z' }))

            const all = ledger.getAll()
            expect(all[0].id).toBe('e1')
            expect(all[1].id).toBe('e2')
            expect(all[2].id).toBe('e3')
        })

        it('returns an empty array when no entries exist', () => {
            expect(ledger.getAll()).toEqual([])
        })

        it('returns copies — mutating results does not affect internal state', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 100, type: 'CREDIT' }))
            const all = ledger.getAll()
                ; (all[0] as any).description = 'mutated'
            expect(ledger.getAll()[0].description).toBe('Test entry')
        })
    })

    // ─── append-only immutability ──────────────────────────────────────────────

    describe('append-only immutability', () => {
        it('earlier entries are unchanged after subsequent appends', () => {
            ledger.append(makeEntry({ id: 'e1', amount: 500, type: 'CREDIT', timestamp: '2024-01-01T00:00:00.000Z' }))
            const snapshot = ledger.getAll()
            ledger.append(makeEntry({ id: 'e2', amount: 100, type: 'DEBIT', timestamp: '2024-01-02T00:00:00.000Z' }))
            // snapshot should still have only 1 entry
            expect(snapshot).toHaveLength(1)
            expect(snapshot[0].running_balance).toBe(500)
        })

        it('mutating the input entry does not affect stored entry', () => {
            const entry = makeEntry({ id: 'e1', amount: 100, type: 'CREDIT' })
            ledger.append(entry)
            entry.description = 'mutated after append'
            expect(ledger.getAll()[0].description).toBe('Test entry')
        })
    })

    // ─── validation errors ─────────────────────────────────────────────────────

    describe('validation', () => {
        it('throws when id is missing', () => {
            expect(() => ledger.append(makeEntry({ id: '' }))).toThrow(/id/)
        })

        it('throws when description is missing', () => {
            expect(() => ledger.append(makeEntry({ description: '' }))).toThrow(/description/)
        })

        it('throws when amount is zero', () => {
            expect(() => ledger.append(makeEntry({ amount: 0 }))).toThrow(/positive/)
        })

        it('throws when amount is negative', () => {
            expect(() => ledger.append(makeEntry({ amount: -50 }))).toThrow(/positive/)
        })

        it('throws when type is missing', () => {
            expect(() => ledger.append(makeEntry({ type: '' as any }))).toThrow(/type/)
        })

        it('throws when agent_role is missing', () => {
            expect(() => ledger.append(makeEntry({ agent_role: '' as any }))).toThrow(/agent_role/)
        })

        it('throws when timestamp is missing', () => {
            expect(() => ledger.append(makeEntry({ timestamp: '' }))).toThrow(/timestamp/)
        })

        it('throws when sprint_id is missing', () => {
            expect(() => ledger.append(makeEntry({ sprint_id: '' }))).toThrow(/sprint_id/)
        })

        it('does not append the entry when validation fails', () => {
            try { ledger.append(makeEntry({ id: '' })) } catch { /* expected */ }
            expect(ledger.getAll()).toHaveLength(0)
        })
    })
})
