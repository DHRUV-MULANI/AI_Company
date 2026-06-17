import { randomUUID } from 'crypto'
import { BaseAgent } from './base-agent.js'
import type { AgentMessage, Employee } from '../types.js'
import type { ActivityLog, TaskBoard, WriteLockManager, EmployeeRegistry } from '../interfaces.js'

/**
 * HR Agent — manages hiring and employee onboarding.
 *
 * Requirements: 3.1, 6.2, 6.3, 6.4, 10.1
 */
export class HRAgent extends BaseAgent {
    private readonly _taskBoardRef: TaskBoard
    private readonly _employeeRegistry: EmployeeRegistry
    private readonly _lockManager: WriteLockManager

    constructor(
        activityLog: ActivityLog,
        taskBoard: TaskBoard,
        writeLockManager: WriteLockManager,
        employeeRegistry: EmployeeRegistry,
    ) {
        super('HR', activityLog, taskBoard, writeLockManager)
        this._taskBoardRef = taskBoard
        this._employeeRegistry = employeeRegistry
        this._lockManager = writeLockManager
    }

    processMessage(msg: AgentMessage): AgentMessage[] {
        const outbound: AgentMessage[] = []

        if (msg.type === 'HIRE_REQUEST') {
            // Enqueue approval request to CEO
            const approvalRequest: AgentMessage = {
                id: randomUUID(),
                from: 'HR',
                to: 'CEO',
                type: 'APPROVAL_REQUEST',
                payload: { ...msg.payload, originalMessageId: msg.id },
                timestamp: new Date().toISOString(),
                correlationId: msg.id,
            }
            this.enqueueOutbound(approvalRequest)
            outbound.push(approvalRequest)

            // Hold associated task in PENDING
            if (msg.payload.task_id) {
                this.updateTask(msg.payload.task_id as string, { status: 'PENDING' })
            }

            this.log('APPROVAL_REQUESTED', `Hire approval requested from CEO`, {
                message_id: msg.id,
                payload: msg.payload,
            })
        } else if (msg.type === 'APPROVAL_RESPONSE') {
            if (msg.payload.approved === true) {
                const employeeData = msg.payload.employeeData as Employee | undefined
                if (employeeData) {
                    const token = this._lockManager.acquire('employee_registry', 'HR')
                    let employee: Employee
                    try {
                        employee = this._employeeRegistry.addEmployee(employeeData)
                    } finally {
                        this._lockManager.release(token)
                    }

                    this.log('EMPLOYEE_ADDED', `Employee added: ${employee.name}`, {
                        employee_id: employee.id,
                        name: employee.name,
                    })

                    const allDone = employee.onboarding_checklist.every(item => item.completed)
                    if (allDone) {
                        this.log('ONBOARDING_COMPLETED', `Onboarding completed for employee: ${employee.name}`, {
                            employee_id: employee.id,
                        })
                    }
                }

                if (msg.payload.task_id) {
                    this.updateTask(msg.payload.task_id as string, { status: 'IN_PROGRESS' })
                }
            } else {
                if (msg.payload.task_id) {
                    this.updateTask(msg.payload.task_id as string, {
                        status: 'BLOCKED',
                        blocker_reason: (msg.payload.reason as string) ?? 'Hire rejected by CEO',
                    })
                }
            }
        }

        return outbound
    }

    tick(): AgentMessage[] {
        const employees = this._employeeRegistry.getAllEmployees()

        for (const employee of employees) {
            if (employee.onboarding_status === 'IN_PROGRESS') {
                const incompleteIndex = employee.onboarding_checklist.findIndex(item => !item.completed)
                if (incompleteIndex !== -1) {
                    const updatedChecklist = employee.onboarding_checklist.map((item, idx) =>
                        idx === incompleteIndex
                            ? { ...item, completed: true, completed_at: new Date().toISOString() }
                            : item,
                    )

                    const token = this._lockManager.acquire('employee_registry', 'HR')
                    try {
                        this._employeeRegistry.updateEmployee(employee.id, {
                            onboarding_checklist: updatedChecklist,
                        })
                    } finally {
                        this._lockManager.release(token)
                    }
                }
            }
        }

        return []
    }
}
