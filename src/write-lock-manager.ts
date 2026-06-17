import { randomUUID } from 'crypto'
import type { AgentRole, LockToken, SharedResource } from './types.js'
import type { WriteLockManager as IWriteLockManager } from './interfaces.js'

export class WriteLockManager implements IWriteLockManager {
  private locks = new Map<SharedResource, LockToken>()

  acquire(resource: SharedResource, agentRole: AgentRole): LockToken {
    if (this.locks.has(resource)) {
      const holder = this.locks.get(resource)!
      throw new Error(
        `Resource '${resource}' is already locked by '${holder.holder}' (token: ${holder.token_id})`
      )
    }

    const token: LockToken = {
      resource,
      holder: agentRole,
      acquired_at: new Date().toISOString(),
      token_id: randomUUID(),
    }

    this.locks.set(resource, token)
    return token
  }

  release(token: LockToken): void {
    const current = this.locks.get(token.resource)

    if (!current) {
      throw new Error(
        `Resource '${token.resource}' is not currently locked`
      )
    }

    if (current.token_id !== token.token_id) {
      throw new Error(
        `Token mismatch for resource '${token.resource}': expected token '${current.token_id}', got '${token.token_id}'`
      )
    }

    this.locks.delete(token.resource)
  }

  isLocked(resource: SharedResource): boolean {
    return this.locks.has(resource)
  }
}
