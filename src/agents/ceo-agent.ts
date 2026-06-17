import { randomUUID } from 'crypto'
import { BaseAgent } from './base-agent.js'
import type { AgentMessage } from '../types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../interfaces.js'

/**
 * CEO Agent — top-level authority in the COS simulation.
 *
 * Responsibilities:
 * - Auto-approve all APPROVAL_REQUEST messages (real veto logic can be added later)
 * - Resolve BLOCKER_ESCALATION messages
 * - Self-assign unassigned CEO-domain tasks each tick
 *
 * Requirements: 3.4, 3.5, 10.1, 10.2
 */
export class CEOAgent extends BaseAgent {
    private readonly _taskBoardRef: TaskBoard

    constructor(
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
    ) {
        super('CEO', activityLog, taskBoard, writeLockManager)
        this._taskBoardRef = taskBoard
    }

    /**
     * Handle incoming messages.
     * - APPROVAL_REQUEST → auto-approve, emit APPROVAL_RESPONSE, log APPROVAL_GRANTED
     * - BLOCKER_ESCALATION → log BLOCKER_RESOLVED, emit BLOCKER_RESOLUTION
     */
    processMessage(msg: AgentMessage): AgentMessage[] {
        const outbound: AgentMessage[] = []

        if (msg.type === 'APPROVAL_REQUEST') {
            const response: AgentMessage = {
                id: randomUUID(),
                from: 'CEO',
                to: msg.from,
                type: 'APPROVAL_RESPONSE',
                // Forward the original payload so the requester has all context
                // (e.g. employeeData for HR, expenseData for Finance)
                payload: { ...msg.payload, approved: true, correlationId: msg.id },
                timestamp: new Date().toISOString(),
                correlationId: msg.id,
            }
            this.enqueueOutbound(response)
            outbound.push(response)

            this.log('APPROVAL_GRANTED', `Approval granted for request from ${msg.from}`, {
                request_id: msg.id,
                requester: msg.from,
            })
        } else if (msg.type === 'BLOCKER_ESCALATION') {
            this.log('BLOCKER_RESOLVED', `Blocker escalation resolved from ${msg.from}`, {
                escalation_id: msg.id,
                escalated_by: msg.from,
                details: msg.payload,
            })

            const resolution: AgentMessage = {
                id: randomUUID(),
                from: 'CEO',
                to: msg.from,
                type: 'BLOCKER_RESOLUTION',
                payload: { resolvedEscalationId: msg.id, ...msg.payload },
                timestamp: new Date().toISOString(),
                correlationId: msg.id,
            }
            this.enqueueOutbound(resolution)
            outbound.push(resolution)
        }

        return outbound
    }

    /**
     * Each sprint tick: self-assign any unassigned CEO-domain tasks
     * (tasks with owner 'CEO' and status 'PENDING').
     */
    tick(): AgentMessage[] {
        const pendingTasks = this._taskBoardRef.getTasksByStatus('PENDING')

        for (const task of pendingTasks) {
            if (task.owner === 'CEO') {
                this.updateTask(task.id, { status: 'IN_PROGRESS' })
            }
        }

        return []
    }
}
