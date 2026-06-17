import { describe, it, expect, beforeEach } from 'vitest'
import { ActivityLog } from '../../../src/stores/activity-log.js'
import type { ActivityEntry } from '../../../src/types.js'

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'entry-1',
    timestamp: '2024-01-01T00:00:00.000Z',
    agent_role: 'CEO',
    event_type: 'TASK_CREATED',
    description: 'A task was created',
    ...overrides,
  }
}

describe('ActivityLog', () => {
  let log: ActivityLog

  beforeEach(() => {
    log = new ActivityLog()
  })

  // ─── append ────────────────────────────────────────────────────────────────

  describe('append', () => {
    it('returns the appended entry', () => {
      const entry = makeEntry()
      const result = log.append(entry)
      expect(result).toEqual(entry)
    })

    it('stores the entry so getAll returns it', () => {
      const entry = makeEntry()
      log.append(entry)
      expect(log.getAll()).toHaveLength(1)
      expect(log.getAll()[0]).toEqual(entry)
    })

    it('returns a copy — mutating the return value does not affect the log', () => {
      const entry = makeEntry()
      const returned = log.append(entry)
      ;(returned as any).description = 'mutated'
      expect(log.getAll()[0].description).toBe('A task was created')
    })

    it('stores a copy — mutating the original entry does not affect the log', () => {
      const entry = makeEntry()
      log.append(entry)
      entry.description = 'mutated after append'
      expect(log.getAll()[0].description).toBe('A task was created')
    })

    it('appends multiple entries independently', () => {
      log.append(makeEntry({ id: 'e1', timestamp: '2024-01-01T00:00:00.000Z' }))
      log.append(makeEntry({ id: 'e2', timestamp: '2024-01-02T00:00:00.000Z' }))
      expect(log.getAll()).toHaveLength(2)
    })
  })

  // ─── getAll ordering ───────────────────────────────────────────────────────

  describe('getAll', () => {
    it('returns entries sorted by timestamp ascending', () => {
      log.append(makeEntry({ id: 'e3', timestamp: '2024-01-03T00:00:00.000Z' }))
      log.append(makeEntry({ id: 'e1', timestamp: '2024-01-01T00:00:00.000Z' }))
      log.append(makeEntry({ id: 'e2', timestamp: '2024-01-02T00:00:00.000Z' }))

      const all = log.getAll()
      expect(all[0].id).toBe('e1')
      expect(all[1].id).toBe('e2')
      expect(all[2].id).toBe('e3')
    })

    it('returns an empty array when no entries exist', () => {
      expect(log.getAll()).toEqual([])
    })

    it('returns copies — mutating results does not affect internal state', () => {
      log.append(makeEntry({ id: 'e1' }))
      const all = log.getAll()
      ;(all[0] as any).description = 'mutated'
      expect(log.getAll()[0].description).toBe('A task was created')
    })

    it('does not mutate earlier entries when new entries are appended', () => {
      log.append(makeEntry({ id: 'e1', timestamp: '2024-01-01T00:00:00.000Z' }))
      const snapshot = log.getAll()
      log.append(makeEntry({ id: 'e2', timestamp: '2024-01-02T00:00:00.000Z' }))
      // snapshot should still have only 1 entry
      expect(snapshot).toHaveLength(1)
    })
  })

  // ─── getEntriesSince filtering ─────────────────────────────────────────────

  describe('getEntriesSince', () => {
    beforeEach(() => {
      log.append(makeEntry({ id: 'e1', timestamp: '2024-01-01T00:00:00.000Z' }))
      log.append(makeEntry({ id: 'e2', timestamp: '2024-01-02T00:00:00.000Z' }))
      log.append(makeEntry({ id: 'e3', timestamp: '2024-01-03T00:00:00.000Z' }))
    })

    it('returns entries with timestamp >= the given timestamp', () => {
      const result = log.getEntriesSince('2024-01-02T00:00:00.000Z')
      expect(result.map(e => e.id)).toEqual(['e2', 'e3'])
    })

    it('includes the entry exactly at the boundary timestamp', () => {
      const result = log.getEntriesSince('2024-01-01T00:00:00.000Z')
      expect(result).toHaveLength(3)
    })

    it('returns empty array when no entries match', () => {
      const result = log.getEntriesSince('2025-01-01T00:00:00.000Z')
      expect(result).toEqual([])
    })

    it('returns results sorted by timestamp ascending', () => {
      const result = log.getEntriesSince('2024-01-01T00:00:00.000Z')
      const timestamps = result.map(e => e.timestamp)
      expect(timestamps).toEqual([...timestamps].sort())
    })
  })

  // ─── validation errors ─────────────────────────────────────────────────────

  describe('validation', () => {
    it('throws when id is missing', () => {
      expect(() => log.append(makeEntry({ id: '' }))).toThrow(/id/)
    })

    it('throws when id is whitespace only', () => {
      expect(() => log.append(makeEntry({ id: '   ' }))).toThrow(/id/)
    })

    it('throws when timestamp is missing', () => {
      expect(() => log.append(makeEntry({ timestamp: '' }))).toThrow(/timestamp/)
    })

    it('throws when agent_role is missing', () => {
      expect(() => log.append(makeEntry({ agent_role: '' as any }))).toThrow(/agent_role/)
    })

    it('throws when event_type is missing', () => {
      expect(() => log.append(makeEntry({ event_type: '' as any }))).toThrow(/event_type/)
    })

    it('throws when description is missing', () => {
      expect(() => log.append(makeEntry({ description: '' }))).toThrow(/description/)
    })

    it('throws when description is whitespace only', () => {
      expect(() => log.append(makeEntry({ description: '   ' }))).toThrow(/description/)
    })

    it('does not append the entry when validation fails', () => {
      try { log.append(makeEntry({ id: '' })) } catch { /* expected */ }
      expect(log.getAll()).toHaveLength(0)
    })
  })
})
