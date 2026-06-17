import { describe, it, expect, beforeEach } from 'vitest'
import { WriteLockManager } from '../../src/write-lock-manager.js'
import type { SharedResource } from '../../src/types.js'

describe('WriteLockManager', () => {
  let manager: WriteLockManager

  beforeEach(() => {
    manager = new WriteLockManager()
  })

  it('acquires a lock and returns a valid token', () => {
    const token = manager.acquire('budget_ledger', 'Finance')
    expect(token.resource).toBe('budget_ledger')
    expect(token.holder).toBe('Finance')
    expect(token.token_id).toBeTruthy()
    expect(token.acquired_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('isLocked returns true after acquire', () => {
    manager.acquire('task_board', 'CEO')
    expect(manager.isLocked('task_board')).toBe(true)
  })

  it('isLocked returns false before acquire', () => {
    expect(manager.isLocked('employee_registry')).toBe(false)
  })

  it('isLocked returns false after release', () => {
    const token = manager.acquire('activity_log', 'HR')
    manager.release(token)
    expect(manager.isLocked('activity_log')).toBe(false)
  })

  it('throws when acquiring an already-locked resource', () => {
    manager.acquire('budget_ledger', 'Finance')
    expect(() => manager.acquire('budget_ledger', 'CEO')).toThrow(
      /already locked/
    )
  })

  it('allows acquiring different resources independently', () => {
    const t1 = manager.acquire('budget_ledger', 'Finance')
    const t2 = manager.acquire('task_board', 'CTO')
    expect(t1.resource).toBe('budget_ledger')
    expect(t2.resource).toBe('task_board')
  })

  it('allows re-acquiring a resource after release', () => {
    const token = manager.acquire('budget_ledger', 'Finance')
    manager.release(token)
    const token2 = manager.acquire('budget_ledger', 'CEO')
    expect(token2.holder).toBe('CEO')
  })

  it('throws on release with wrong token', () => {
    const token = manager.acquire('budget_ledger', 'Finance')
    const fakeToken = { ...token, token_id: 'wrong-id' }
    expect(() => manager.release(fakeToken)).toThrow(/Token mismatch/)
  })

  it('throws on release when resource is not locked', () => {
    const token = manager.acquire('budget_ledger', 'Finance')
    manager.release(token)
    expect(() => manager.release(token)).toThrow(/not currently locked/)
  })

  it('each acquired token has a unique token_id', () => {
    const t1 = manager.acquire('budget_ledger', 'Finance')
    manager.release(t1)
    const t2 = manager.acquire('budget_ledger', 'Finance')
    expect(t1.token_id).not.toBe(t2.token_id)
  })

  it('locks are independent per resource', () => {
    const resources: SharedResource[] = ['budget_ledger', 'employee_registry', 'activity_log', 'task_board']
    const tokens = resources.map(r => manager.acquire(r, 'CEO'))
    resources.forEach(r => expect(manager.isLocked(r)).toBe(true))
    tokens.forEach(t => manager.release(t))
    resources.forEach(r => expect(manager.isLocked(r)).toBe(false))
  })
})
