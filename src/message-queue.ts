import type { AgentMessage } from './types.js'
import type { MessageQueue as IMessageQueue } from './interfaces.js'

export class MessageQueue implements IMessageQueue {
  private queue: AgentMessage[] = []

  enqueue(msg: AgentMessage): void {
    this.queue.push(msg)
  }

  dequeue(): AgentMessage | null {
    return this.queue.length > 0 ? this.queue.shift()! : null
  }

  peek(): AgentMessage | null {
    return this.queue.length > 0 ? this.queue[0] : null
  }

  size(): number {
    return this.queue.length
  }

  isEmpty(): boolean {
    return this.queue.length === 0
  }
}
