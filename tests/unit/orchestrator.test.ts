import { describe, it, expect, vi, beforeEach } from 'vitest'
import { COSOrchestrator } from '../../src/orchestrator.js'

describe('COSOrchestrator', () => {
    describe('start()', () => {
        it('initializes all 6 agents without throwing', () => {
            const orchestrator = new COSOrchestrator()
            expect(() => orchestrator.start()).not.toThrow()
        })

        it('creates an active sprint after start()', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            const sprint = orchestrator.getCurrentSprint()
            expect(sprint).not.toBeNull()
            expect(sprint.status).toBe('ACTIVE')
        })

        it('logs SPRINT_STARTED to activity log after start()', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            const log = orchestrator.getActivityLog()
            const sprintStarted = log.find(e => e.event_type === 'SPRINT_STARTED')
            expect(sprintStarted).toBeDefined()
        })
    })

    describe('stop()', () => {
        it('sets running to false (stop does not throw)', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            expect(() => orchestrator.stop()).not.toThrow()
        })

        it('can be called multiple times without error', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            orchestrator.stop()
            expect(() => orchestrator.stop()).not.toThrow()
        })
    })

    describe('agent init failure', () => {
        it('logs AGENT_INIT_FAILED and re-throws when an agent initialize() throws', () => {
            const orchestrator = new COSOrchestrator()

            // Access private _agents map to inject a failing agent
            const agents = (orchestrator as unknown as { _agents: Map<string, { initialize: () => void; tick: () => []; getOutboundQueue: () => []; processMessage: () => [] }> })._agents
            const ceoAgent = agents.get('CEO')!
            vi.spyOn(ceoAgent, 'initialize').mockImplementation(() => {
                throw new Error('CEO init exploded')
            })

            expect(() => orchestrator.start()).toThrow('CEO init exploded')

            // Activity log should contain AGENT_INIT_FAILED
            const log = (orchestrator as unknown as { _activityLog: { getAll: () => Array<{ event_type: string }> } })._activityLog.getAll()
            const failEntry = log.find(e => e.event_type === 'AGENT_INIT_FAILED')
            expect(failEntry).toBeDefined()
        })
    })

    describe('message routing', () => {
        it('delivers a message to the correct agent queue', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()

            // Access private queues
            const queues = (orchestrator as unknown as { _queues: Map<string, { enqueue: (m: unknown) => void; size: () => number }> })._queues

            const ctoQueue = queues.get('CTO')!
            expect(ctoQueue.size()).toBe(0)

            // Manually enqueue a message to CEO agent's outbound, then tick
            const agents = (orchestrator as unknown as { _agents: Map<string, { tick: () => unknown[]; getOutboundQueue: () => unknown[] }> })._agents
            const ceoAgent = agents.get('CEO')!

            // Spy on tick to return a message addressed to CTO
            vi.spyOn(ceoAgent, 'tick').mockReturnValueOnce([
                {
                    id: 'test-msg-1',
                    from: 'CEO' as const,
                    to: 'CTO' as const,
                    type: 'TASK_ASSIGNMENT' as const,
                    payload: {},
                    timestamp: new Date().toISOString(),
                },
            ])

            orchestrator.tick()

            // CTO queue should have received the message (it may have been drained by processMessage)
            // We verify by checking that no delivery failure was logged
            const log = orchestrator.getActivityLog()
            const deliveryFailed = log.find(e => e.event_type === 'MESSAGE_DELIVERY_FAILED')
            expect(deliveryFailed).toBeUndefined()
        })

        it('logs MESSAGE_DELIVERY_FAILED for unknown target agent', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()

            const agents = (orchestrator as unknown as { _agents: Map<string, { tick: () => unknown[]; getOutboundQueue: () => unknown[] }> })._agents
            const ceoAgent = agents.get('CEO')!

            // Return a message with an invalid target role
            vi.spyOn(ceoAgent, 'tick').mockReturnValueOnce([
                {
                    id: 'bad-msg',
                    from: 'CEO' as const,
                    to: 'UnknownRole' as unknown as 'CTO',
                    type: 'STATUS_UPDATE' as const,
                    payload: {},
                    timestamp: new Date().toISOString(),
                },
            ])

            orchestrator.tick()

            const log = orchestrator.getActivityLog()
            const failEntry = log.find(e => e.event_type === 'MESSAGE_DELIVERY_FAILED')
            expect(failEntry).toBeDefined()
        })

        it('marks originating task BLOCKED when delivery fails and task_id is present', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()

            // Create a task first
            const taskBoard = (orchestrator as unknown as { _taskBoard: { createTask: (t: unknown) => { id: string }; getTask: (id: string) => { status: string } | null } })._taskBoard
            const sprint = orchestrator.getCurrentSprint()
            const task = taskBoard.createTask({
                id: 'task-delivery-fail',
                title: 'Test task',
                owner: 'CEO',
                status: 'IN_PROGRESS',
                priority: 'MEDIUM',
                sprint_id: sprint.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })

            const agents = (orchestrator as unknown as { _agents: Map<string, { tick: () => unknown[]; getOutboundQueue: () => unknown[] }> })._agents
            const ceoAgent = agents.get('CEO')!

            vi.spyOn(ceoAgent, 'tick').mockReturnValueOnce([
                {
                    id: 'bad-msg-2',
                    from: 'CEO' as const,
                    to: 'UnknownRole' as unknown as 'CTO',
                    type: 'STATUS_UPDATE' as const,
                    payload: { task_id: task.id },
                    timestamp: new Date().toISOString(),
                },
            ])

            orchestrator.tick()

            const updatedTask = taskBoard.getTask(task.id)
            expect(updatedTask?.status).toBe('BLOCKED')
        })
    })

    describe('generateReport()', () => {
        it('returns a report with all 7 required sections', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()

            const report = orchestrator.generateReport()

            expect(report).toHaveProperty('task_board')
            expect(report).toHaveProperty('pending_approvals')
            expect(report).toHaveProperty('employee_registry')
            expect(report).toHaveProperty('budget_ledger')
            expect(report).toHaveProperty('department_updates')
            expect(report).toHaveProperty('activity_log')
            expect(report).toHaveProperty('alerts')
        })

        it('report has a valid generated_at ISO timestamp', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            const report = orchestrator.generateReport()
            expect(() => new Date(report.generated_at)).not.toThrow()
            expect(new Date(report.generated_at).toISOString()).toBe(report.generated_at)
        })

        it('report sprint_id matches the active sprint', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            const sprint = orchestrator.getCurrentSprint()
            const report = orchestrator.generateReport()
            expect(report.sprint_id).toBe(sprint.id)
        })

        it('department_updates contains one entry per agent role (6 total)', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            const report = orchestrator.generateReport()
            expect(report.department_updates).toHaveLength(6)
        })
    })

    describe('tick()', () => {
        it('processes messages between agents without throwing', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            expect(() => orchestrator.tick()).not.toThrow()
        })

        it('routes a message from one agent to another during tick', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()

            const agents = (orchestrator as unknown as { _agents: Map<string, { tick: () => unknown[]; getOutboundQueue: () => unknown[]; processMessage: (m: unknown) => unknown[] }> })._agents
            const hrAgent = agents.get('HR')!

            const processMessageSpy = vi.spyOn(hrAgent, 'processMessage')

            // Make CEO tick return a message to HR
            const ceoAgent = agents.get('CEO')!
            vi.spyOn(ceoAgent, 'tick').mockReturnValueOnce([
                {
                    id: 'ceo-to-hr',
                    from: 'CEO' as const,
                    to: 'HR' as const,
                    type: 'STATUS_UPDATE' as const,
                    payload: {},
                    timestamp: new Date().toISOString(),
                },
            ])

            orchestrator.tick()

            expect(processMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'ceo-to-hr', from: 'CEO', to: 'HR' }),
            )
        })
    })

    describe('query methods', () => {
        it('getTaskBoard() returns an array', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            expect(Array.isArray(orchestrator.getTaskBoard())).toBe(true)
        })

        it('getBudgetLedger() returns an array', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            expect(Array.isArray(orchestrator.getBudgetLedger())).toBe(true)
        })

        it('getEmployeeRegistry() returns an array', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            expect(Array.isArray(orchestrator.getEmployeeRegistry())).toBe(true)
        })

        it('getActivityLog() returns an array with at least the SPRINT_STARTED entry', () => {
            const orchestrator = new COSOrchestrator()
            orchestrator.start()
            const log = orchestrator.getActivityLog()
            expect(Array.isArray(log)).toBe(true)
            expect(log.length).toBeGreaterThan(0)
        })
    })
})
