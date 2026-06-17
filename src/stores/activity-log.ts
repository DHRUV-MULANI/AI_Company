import type { ActivityEntry } from '../types.js'
import type { ActivityLog as IActivityLog } from '../interfaces.js'

export class ActivityLog implements IActivityLog {
  private readonly _entries: ActivityEntry[] = []

  append(entry: ActivityEntry): ActivityEntry {
    const { id, timestamp, agent_role, event_type, description } = entry

    if (!id || !id.trim()) throw new Error('ActivityEntry missing required field: id')
    if (!timestamp || !timestamp.trim()) throw new Error('ActivityEntry missing required field: timestamp')
    if (!agent_role || !(agent_role as string).trim()) throw new Error('ActivityEntry missing required field: agent_role')
    if (!event_type || !(event_type as string).trim()) throw new Error('ActivityEntry missing required field: event_type')
    if (!description || !description.trim()) throw new Error('ActivityEntry missing required field: description')

    const copy: ActivityEntry = { ...entry }
    if (copy.metadata !== undefined) {
      copy.metadata = { ...copy.metadata }
    }
    this._entries.push(copy)
    return { ...copy }
  }

  getAll(): ActivityEntry[] {
    return [...this._entries]
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(e => ({ ...e }))
  }

  getEntriesSince(timestamp: string): ActivityEntry[] {
    return this._entries
      .filter(e => e.timestamp >= timestamp)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(e => ({ ...e }))
  }
}
