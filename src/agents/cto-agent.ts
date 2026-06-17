import { randomUUID } from 'crypto'
import { BaseAgent } from './base-agent.js'
import type { AgentMessage } from '../types.js'
import type { ActivityLog, TaskBoard, WriteLockManager } from '../interfaces.js'

/**
 * CTO Agent — manages technical tasks and blocker resolution.
 *
 * Requirements: 10.1, 10.2, 10.3
 */
export class CTOAgent extends BaseAgent {
    private readonly _taskBoardRef: TaskBoard

    constructor(
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
    ) {
        super('CTO', activityLog, taskBoard, writeLockManager)
        this._taskBoardRef = taskBoard
    }

    processMessage(msg: AgentMessage): AgentMessage[] {
        const outbound: AgentMessage[] = []

        if (msg.type === 'TASK_ASSIGNMENT') {
            if (msg.payload.task_id) {
                this.updateTask(msg.payload.task_id as string, { status: 'IN_PROGRESS' })
            }
        } else if (msg.type === 'BLOCKER_RESOLUTION') {
            if (msg.payload.task_id) {
                this.updateTask(msg.payload.task_id as string, { status: 'IN_PROGRESS' })
            }

            this.log('BLOCKER_RESOLVED', `Blocker resolved for task`, {
                message_id: msg.id,
                from: msg.from,
                payload: msg.payload,
            })
        }

        return outbound
    }

    tick(): AgentMessage[] {
        const pendingTasks = this._taskBoardRef.getTasksByStatus('PENDING')

        for (const task of pendingTasks) {
            if (task.owner === 'CTO') {
                this.updateTask(task.id, { status: 'IN_PROGRESS' })
            }
        }

        return []
    }
}
