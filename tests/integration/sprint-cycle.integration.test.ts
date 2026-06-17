import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { COSOrchestrator } from '../../src/orchestrator.js'
import type { AgentMessage, Task } from '../../src/types.js'
import type { MessageQueue } from '../../src/message-queue.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getQueues(orchestrator: COSOrchestrator): Map<string, MessageQueue> {
    return (orchestrator as any)._queues
}

function getTaskBoard(orchestrator: COSOrchestrator) {
    return (orchestrator as any)._taskBoard
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

describe('Sprint Cycle Integration', () => {
    let orchestrator: COSOrchestrator

    beforeEach(() => {
        orchestrator = new COSOrchestrator()
        orchestrator.start()
    })

    /**
     * Requirement 10.1 — Agent self-assignment
     * A PENDING task owned by 'CTO' should transition to IN_PROGRESS after tick().
     */
    it('CTO self-assigns a PENDING task to IN_PROGRESS on tick (Req 10.1)', () => {
        const sprint = orchestrator.getCurrentSprint()
        const taskBoard = getTaskBoard(orchestrator)

        const task: Task = {
            id: randomUUID(),
            title: 'CTO self-assign task',
            owner: 'CTO',
            status: 'PENDING',
            priority: 'MEDIUM',
            sprint_id: sprint.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }
        taskBoard.createTask(task)

        orchestrator.tick()

        const updated = taskBoard.getTask(task.id)
        expect(updated?.status).toBe('IN_PROGRESS')
    })

    /**
     * Requirement 2.3 — Message processing within sprint cycle
     * A message injected into the CEO queue is processed within the same tick().
     */
    it('processes a message injected into CEO queue within the same tick (Req 2.3)', () => {
        const queues = getQueues(orchestrator)
        const ceoQueue = queues.get('CEO')!

        // Inject a BLOCKER_ESCALATION from Operations into CEO queue
        // CEO will process it and log BLOCKER_RESOLVED
        const msg = makeMsg({
            from: 'Operations',
            to: 'CEO',
            type: 'BLOCKER_ESCALATION',
            payload: { reason: 'dependency missing' },
        })
        ceoQueue.enqueue(msg)

        expect(ceoQueue.size()).toBe(1)

        orchestrator.tick()

        // Queue should be drained after tick
        expect(ceoQueue.size()).toBe(0)

        // CEO should have logged BLOCKER_RESOLVED
        const log = orchestrator.getActivityLog()
        const resolved = log.find(e => e.event_type === 'BLOCKER_RESOLVED')
        expect(resolved).toBeDefined()
    })

    /**
     * Requirement 10.3 — Blocker escalation resolved within sprint cycle
     * A BLOCKER_ESCALATION injected into Operations queue should result in a
     * BLOCKER_RESOLVED or BLOCKER_RESOLUTION log entry after tick().
     */
    it('resolves a BLOCKER_ESCALATION injected into Operations queue within tick (Req 10.3)', () => {
        const sprint = orchestrator.getCurrentSprint()
        const taskBoard = getTaskBoard(orchestrator)

        // Create a BLOCKED task owned by Operations
        const task: Task = {
            id: randomUUID(),
            title: 'Blocked ops task',
            owner: 'Operations',
            status: 'IN_PROGRESS',
            priority: 'HIGH',
            sprint_id: sprint.id,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }
        taskBoard.createTask(task)
        taskBoard.updateTask(task.id, { status: 'BLOCKED', blocker_reason: 'external dependency' })

        const queues = getQueues(orchestrator)
        const opsQueue = queues.get('Operations')!

        // Inject a non-critical BLOCKER_ESCALATION so Operations resolves it locally
        const msg = makeMsg({
            from: 'CTO',
            to: 'Operations',
            type: 'BLOCKER_ESCALATION',
            payload: { task_id: task.id, reason: 'external dependency', severity: 'MEDIUM' },
        })
        opsQueue.enqueue(msg)

        orchestrator.tick()

        // Verify a BLOCKER_RESOLVED log entry exists
        const log = orchestrator.getActivityLog()
        const resolved = log.find(
            e => e.event_type === 'BLOCKER_RESOLVED',
        )
        expect(resolved).toBeDefined()
    })
})
