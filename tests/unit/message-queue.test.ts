import { describe, it, expect, beforeEach } from 'vitest'
import { MessageQueue } from '../../src/message-queue.js'
import type { AgentMessage } from '../../src/types.js'

function makeMsg(id: string): AgentMessage {
  return {
    id,
    from: 'CEO',
    to: 'CTO',
    type: 'TASK_ASSIGNMENT',
    payload: {},
    timestamp: new Date().toISOString(),
  }
}

describe('MessageQueue', () => {
  let q: MessageQueue

  beforeEach(() => {
    q = new MessageQueue()
  })

  it('starts empty', () => {
    expect(q.isEmpty()).toBe(true)
    expect(q.size()).toBe(0)
  })

  it('enqueue increases size', () => {
    q.enqueue(makeMsg('a'))
    expect(q.size()).toBe(1)
    expect(q.isEmpty()).toBe(false)
  })

  it('dequeue returns null when empty', () => {
    expect(q.dequeue()).toBeNull()
  })

  it('peek returns null when empty', () => {
    expect(q.peek()).toBeNull()
  })

  it('peek does not remove the message', () => {
    const msg = makeMsg('a')
    q.enqueue(msg)
    expect(q.peek()).toBe(msg)
    expect(q.size()).toBe(1)
  })

  it('dequeue returns messages in FIFO order', () => {
    const msgs = ['a', 'b', 'c'].map(makeMsg)
    msgs.forEach(m => q.enqueue(m))
    expect(q.dequeue()).toBe(msgs[0])
    expect(q.dequeue()).toBe(msgs[1])
    expect(q.dequeue()).toBe(msgs[2])
    expect(q.dequeue()).toBeNull()
  })
})
