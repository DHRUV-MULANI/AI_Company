import { randomUUID } from 'crypto'
import type { AgentMessage, AgentRole, PendingApproval, Sprint } from './types.js'
import type { COSOrchestrator as ICOSOrchestrator, Agent } from './interfaces.js'
import type { Report, Task, LedgerEntry, Employee, ActivityEntry } from './types.js'

import { ActivityLog } from './stores/activity-log.js'
import { TaskBoard } from './stores/task-board.js'
import { BudgetLedger } from './stores/budget-ledger.js'
import { EmployeeRegistry } from './stores/employee-registry.js'
import { SprintStore } from './stores/sprint-store.js'
import { WriteLockManager } from './write-lock-manager.js'
import { MessageQueue } from './message-queue.js'
import { ReportGenerator } from './report-generator.js'

import { CEOAgent } from './agents/ceo-agent.js'
import { CTOAgent } from './agents/cto-agent.js'
import { HRAgent } from './agents/hr-agent.js'
import { FinanceAgent } from './agents/finance-agent.js'
import { OperationsAgent } from './agents/operations-agent.js'
import { MarketingAgent } from './agents/marketing-agent.js'

const ALL_ROLES: AgentRole[] = ['CEO', 'CTO', 'HR', 'Finance', 'Operations', 'Marketing']

/**
 * COS Orchestrator — wires all agents, stores, and message queues together.
 *
 * Requirements: 1.1, 1.3, 1.4, 2.1, 2.3, 9.2
 */
export class COSOrchestrator implements ICOSOrchestrator {
    private _running = false

    // Shared stores
    private readonly _activityLog: ActivityLog
    private readonly _taskBoard: TaskBoard
    private readonly _budgetLedger: BudgetLedger
    private readonly _employeeRegistry: EmployeeRegistry
    private readonly _sprintStore: SprintStore
    private readonly _writeLockManager: WriteLockManager

    // Per-agent message queues
    private readonly _queues: Map<AgentRole, MessageQueue>

    // Agents
    private readonly _agents: Map<AgentRole, Agent>

    // Report generator
    private readonly _reportGenerator: ReportGenerator
    private readonly _pendingApprovals: PendingApproval[]

    constructor() {
        // Create shared stores
        this._activityLog = new ActivityLog()
        this._taskBoard = new TaskBoard(this._activityLog)
        this._budgetLedger = new BudgetLedger(this._activityLog)
        this._employeeRegistry = new EmployeeRegistry()
        this._sprintStore = new SprintStore(this._activityLog, this._taskBoard)
        this._writeLockManager = new WriteLockManager()

        // Create per-agent message queues
        this._queues = new Map()
        for (const role of ALL_ROLES) {
            this._queues.set(role, new MessageQueue())
        }

        // Instantiate all 6 agents
        this._agents = new Map()
        this._agents.set('CEO', new CEOAgent(this._activityLog, this._taskBoard, this._writeLockManager))
        this._agents.set('CTO', new CTOAgent(this._activityLog, this._taskBoard, this._writeLockManager))
        this._agents.set('HR', new HRAgent(this._activityLog, this._taskBoard, this._writeLockManager, this._employeeRegistry))
        this._agents.set('Finance', new FinanceAgent(this._activityLog, this._taskBoard, this._writeLockManager, this._budgetLedger))
        this._agents.set('Operations', new OperationsAgent(this._activityLog, this._taskBoard, this._writeLockManager))
        this._agents.set('Marketing', new MarketingAgent(this._activityLog, this._taskBoard, this._writeLockManager))

        // Shared pending approvals array for report generator
        this._pendingApprovals = []

        // Create report generator
        this._reportGenerator = new ReportGenerator(
            this._taskBoard,
            this._budgetLedger,
            this._employeeRegistry,
            this._activityLog,
            this._pendingApprovals,
        )
    }

    /**
     * Initialize all agents, create the first sprint, and set running = true.
     */
    start(): void {
        this._initializeAgents()

        // Create the first sprint
        this._sprintStore.createSprint({
            id: randomUUID(),
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            budget_allocation: 10000,
            status: 'ACTIVE',
        })

        this._running = true
    }

    /**
     * Halt the orchestrator.
     */
    stop(): void {
        this._running = false
    }

    /**
     * Advance one sprint cycle: tick all agents, route messages, process inbound queues.
     */
    tick(): void {
        const outbound: AgentMessage[] = []

        // Phase 1: tick each agent and collect returned messages
        for (const agent of this._agents.values()) {
            const msgs = agent.tick()
            outbound.push(...msgs)
        }

        // Phase 2: collect buffered outbound messages from each agent
        for (const agent of this._agents.values()) {
            const msgs = agent.getOutboundQueue()
            outbound.push(...msgs)
        }

        // Route all collected messages to recipient queues
        this._routeMessages(outbound)

        // Phase 3: drain each agent's inbound queue and call processMessage
        const secondRoundOutbound: AgentMessage[] = []
        for (const [role, agent] of this._agents.entries()) {
            const queue = this._queues.get(role)!
            let msg: AgentMessage | null
            while ((msg = queue.dequeue()) !== null) {
                const replies = agent.processMessage(msg)
                secondRoundOutbound.push(...replies)
            }
            // Also collect any newly buffered outbound from processMessage
            secondRoundOutbound.push(...agent.getOutboundQueue())
        }

        // Route second-round messages (one additional round)
        this._routeMessages(secondRoundOutbound)
    }

    generateReport(): Report {
        const sprint = this._sprintStore.getActiveSprint()
        if (!sprint) {
            throw new Error('No active sprint to generate report for')
        }
        return this._reportGenerator.generate(sprint)
    }

    getCurrentSprint(): Sprint {
        const sprint = this._sprintStore.getActiveSprint()
        if (!sprint) {
            throw new Error('No active sprint')
        }
        return sprint
    }

    getTaskBoard(): Task[] {
        return this._taskBoard.getAllTasks()
    }

    getBudgetLedger(): LedgerEntry[] {
        return this._budgetLedger.getAll()
    }

    getEmployeeRegistry(): Employee[] {
        return this._employeeRegistry.getAllEmployees()
    }

    getActivityLog(): ActivityEntry[] {
        return this._activityLog.getAll()
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private _initializeAgents(): void {
        for (const [role, agent] of this._agents.entries()) {
            try {
                agent.initialize()
            } catch (err) {
                this._activityLog.append({
                    id: randomUUID(),
                    timestamp: new Date().toISOString(),
                    agent_role: role,
                    event_type: 'AGENT_INIT_FAILED',
                    description: `Agent ${role} failed to initialize: ${err instanceof Error ? err.message : String(err)}`,
                    metadata: { role, error: String(err) },
                })
                throw err
            }
        }
    }

    private _routeMessages(messages: AgentMessage[]): void {
        for (const msg of messages) {
            const targetQueue = this._queues.get(msg.to)
            if (!targetQueue) {
                // Log delivery failure
                this._activityLog.append({
                    id: randomUUID(),
                    timestamp: new Date().toISOString(),
                    agent_role: msg.from,
                    event_type: 'MESSAGE_DELIVERY_FAILED',
                    description: `Message delivery failed: target agent '${msg.to}' not found`,
                    metadata: { message_id: msg.id, from: msg.from, to: msg.to },
                })

                // Mark originating task BLOCKED if task_id present
                if (msg.payload.task_id) {
                    try {
                        this._taskBoard.updateTask(msg.payload.task_id as string, {
                            status: 'BLOCKED',
                            blocker_reason: `Message delivery failed: target agent '${msg.to}' not found`,
                        })
                    } catch {
                        // Task may not exist; ignore
                    }
                }
                continue
            }
            targetQueue.enqueue(msg)
        }
    }
}
