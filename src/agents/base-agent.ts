import { randomUUID } from 'crypto'
import type { AgentRole, AgentMessage, ActivityEventType, Task } from '../types.js'
import type { Agent } from '../interfaces.js'
import type { ActivityLog } from '../interfaces.js'
import type { TaskBoard } from '../interfaces.js'
import type { WriteLockManager } from '../interfaces.js'

/**
 * Abstract base class for all COS agents.
 * Satisfies the Agent interface and provides shared infrastructure:
 * - Outbound message buffering
 * - Locked writes to ActivityLog and TaskBoard
 * - Logging helpers
 *
 * Requirements: 1.2, 7.3
 */
export abstract class BaseAgent implements Agent {
    readonly role: AgentRole

    private readonly _activityLog: ActivityLog
    private readonly _taskBoard: TaskBoard
    private readonly _writeLockManager: WriteLockManager
    private _outboundBuffer: AgentMessage[] = []

    constructor(
        role: AgentRole,
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
    ) {
        this.role = role
        this._activityLog = activityLog
        this._taskBoard = taskBoard
        this._writeLockManager = writeLockManager
    }

    /**
     * Sets up the agent. Subclasses may override but should call super.initialize().
     */
    initialize(): void {
        // Base implementation is a no-op; subclasses extend as needed.
    }

    /**
     * Returns all messages in the outbound buffer and clears it.
     */
    getOutboundQueue(): AgentMessage[] {
        const messages = this._outboundBuffer
        this._outboundBuffer = []
        return messages
    }

    /**
     * Process an incoming message and return any immediate outbound replies.
     * Subclasses must implement this.
     */
    abstract processMessage(msg: AgentMessage): AgentMessage[]

    /**
     * Proactive behavior executed each sprint tick.
     * Subclasses must implement this.
     */
    abstract tick(): AgentMessage[]

    // ─── Protected helpers ────────────────────────────────────────────────────

    /**
     * Appends an entry to the ActivityLog under an exclusive write lock.
     * Logs LOCK_ACQUIRED and LOCK_RELEASED around the append.
     */
    protected log(
        eventType: ActivityEventType,
        description: string,
        metadata?: Record<string, unknown>,
    ): void {
        const token = this._writeLockManager.acquire('activity_log', this.role)
        try {
            this._activityLog.append({
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                agent_role: this.role,
                event_type: eventType,
                description,
                ...(metadata !== undefined ? { metadata } : {}),
            })
        } finally {
            this._writeLockManager.release(token)
        }
    }

    /**
     * Creates a task on the TaskBoard under an exclusive write lock,
     * then logs TASK_CREATED to the ActivityLog.
     */
    protected createTask(task: Task): Task {
        const token = this._writeLockManager.acquire('task_board', this.role)
        let created: Task
        try {
            created = this._taskBoard.createTask(task)
        } finally {
            this._writeLockManager.release(token)
        }

        this.log('TASK_CREATED', `Task created: ${created.title}`, {
            task_id: created.id,
            status: created.status,
        })

        return created
    }

    /**
     * Updates a task on the TaskBoard under an exclusive write lock.
     * Logs TASK_STATE_CHANGED if the status changed.
     */
    protected updateTask(id: string, patch: Partial<Task>): Task {
        // Read current task before acquiring lock (reads are lock-free)
        const before = this._taskBoard.getTask(id)

        const token = this._writeLockManager.acquire('task_board', this.role)
        let updated: Task
        try {
            updated = this._taskBoard.updateTask(id, patch)
        } finally {
            this._writeLockManager.release(token)
        }

        if (patch.status !== undefined && before?.status !== updated.status) {
            this.log('TASK_STATE_CHANGED', `Task ${id} transitioned: ${before?.status} → ${updated.status}`, {
                task_id: id,
                from: before?.status,
                to: updated.status,
            })
        }

        return updated
    }

    /**
     * Adds a message to the internal outbound buffer.
     */
    protected enqueueOutbound(msg: AgentMessage): void {
        this._outboundBuffer.push(msg)
    }
}
