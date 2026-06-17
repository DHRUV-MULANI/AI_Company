import { BaseAgent } from './base-agent.js'
import type { AgentMessage } from '../types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../interfaces.js'

/**
 * Marketing Agent — manages campaign approvals and task self-assignment.
 *
 * Requirements: 10.1, 10.2
 */
export class MarketingAgent extends BaseAgent {
    private readonly _taskBoardRef: TaskBoard

    constructor(
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
    ) {
        super('Marketing', activityLog, taskBoard, writeLockManager)
        this._taskBoardRef = taskBoard
    }

    processMessage(msg: AgentMessage): AgentMessage[] {
        if (msg.type === 'APPROVAL_RESPONSE') {
            if (msg.payload.approved === true) {
                this.log('EXPENSE_COMMITTED', `Campaign expense approved and committed`, {
                    message_id: msg.id,
                    payload: msg.payload,
                })
            } else {
                if (msg.payload.task_id) {
                    this.updateTask(msg.payload.task_id as string, {
                        status: 'BLOCKED',
                        blocker_reason: (msg.payload.reason as string) ?? 'Campaign expense rejected by CEO',
                    })
                }
            }
        }

        return []
    }

    tick(): AgentMessage[] {
        const pendingTasks = this._taskBoardRef.getTasksByStatus('PENDING')

        for (const task of pendingTasks) {
            if (task.owner === 'Marketing') {
                this.updateTask(task.id, { status: 'IN_PROGRESS' })
            }
        }

        return []
    }
}
