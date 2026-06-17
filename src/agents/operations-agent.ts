import { randomUUID } from 'crypto'
import { BaseAgent } from './base-agent.js'
import type { AgentMessage } from '../types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../interfaces.js'

/**
 * Operations Agent — handles blocker escalations and task management.
 *
 * Requirements: 10.1, 10.2, 10.3
 */
export class OperationsAgent extends BaseAgent {
    private readonly _taskBoardRef: TaskBoard

    constructor(
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
    ) {
        super('Operations', activityLog, taskBoard, writeLockManager)
        this._taskBoardRef = taskBoard
    }

    processMessage(msg: AgentMessage): AgentMessage[] {
        const outbound: AgentMessage[] = []

        if (msg.type === 'BLOCKER_ESCALATION') {
            const severity = msg.payload.severity as string | undefined

            if (severity === 'CRITICAL') {
                // Forward to CEO
                const escalation: AgentMessage = {
                    id: randomUUID(),
                    from: 'Operations',
                    to: 'CEO',
                    type: 'BLOCKER_ESCALATION',
                    payload: { ...msg.payload, escalatedBy: msg.from, originalEscalationId: msg.id },
                    timestamp: new Date().toISOString(),
                    correlationId: msg.id,
                }
                this.enqueueOutbound(escalation)
                outbound.push(escalation)
            } else {
                // Resolve locally
                this.log('BLOCKER_RESOLVED', `Blocker resolved locally by Operations`, {
                    escalation_id: msg.id,
                    from: msg.from,
                    payload: msg.payload,
                })

                const resolution: AgentMessage = {
                    id: randomUUID(),
                    from: 'Operations',
                    to: msg.from,
                    type: 'BLOCKER_RESOLUTION',
                    payload: { resolvedEscalationId: msg.id, ...msg.payload },
                    timestamp: new Date().toISOString(),
                    correlationId: msg.id,
                }
                this.enqueueOutbound(resolution)
                outbound.push(resolution)
            }
        }

        return outbound
    }

    tick(): AgentMessage[] {
        const pendingTasks = this._taskBoardRef.getTasksByStatus('PENDING')

        for (const task of pendingTasks) {
            if (task.owner === 'Operations') {
                this.updateTask(task.id, { status: 'IN_PROGRESS' })
            }
        }

        return []
    }
}
