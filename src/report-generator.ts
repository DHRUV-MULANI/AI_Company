import type {
    AgentRole,
    Alert,
    DepartmentUpdate,
    PendingApproval,
    Report,
    Sprint,
} from './types.js'
import type {
    ActivityLog,
    BudgetLedger,
    EmployeeRegistry,
    ReportGenerator as IReportGenerator,
    TaskBoard,
} from './interfaces.js'

const ALL_ROLES: AgentRole[] = ['CEO', 'CTO', 'HR', 'Finance', 'Operations', 'Marketing']

const ALERT_EVENT_TYPES = new Set(['BUDGET_ALERT', 'BUDGET_WARNING', 'TASK_BLOCKED'])

export class ReportGenerator implements IReportGenerator {
    private readonly _taskBoard: TaskBoard
    private readonly _budgetLedger: BudgetLedger
    private readonly _employeeRegistry: EmployeeRegistry
    private readonly _activityLog: ActivityLog
    private readonly _pendingApprovals: PendingApproval[]

    constructor(
        taskBoard: TaskBoard,
        budgetLedger: BudgetLedger,
        employeeRegistry: EmployeeRegistry,
        activityLog: ActivityLog,
        pendingApprovals: PendingApproval[],
    ) {
        this._taskBoard = taskBoard
        this._budgetLedger = budgetLedger
        this._employeeRegistry = employeeRegistry
        this._activityLog = activityLog
        this._pendingApprovals = pendingApprovals
    }

    generate(sprint: Sprint): Report {
        const tasks = this._taskBoard.getAllTasks()
        const ledgerEntries = this._budgetLedger.getAll()
        const employees = this._employeeRegistry.getAllEmployees()
        const activityEntries = this._activityLog.getAll()

        // Build department updates — one per AgentRole
        const departmentUpdates: DepartmentUpdate[] = ALL_ROLES.map(role => {
            const roleTasks = tasks.filter(t => t.owner === role)
            return {
                agent_role: role,
                summary: `${role} has ${roleTasks.length} task(s) total`,
                tasks_completed: roleTasks.filter(t => t.status === 'COMPLETED').length,
                tasks_in_progress: roleTasks.filter(t => t.status === 'IN_PROGRESS').length,
                tasks_blocked: roleTasks.filter(t => t.status === 'BLOCKED').length,
            }
        })

        // Derive alerts from activity log entries with relevant event types
        const alerts: Alert[] = activityEntries
            .filter(e => ALERT_EVENT_TYPES.has(e.event_type))
            .map(e => {
                let type: Alert['type']
                let severity: Alert['severity']

                if (e.event_type === 'BUDGET_ALERT') {
                    type = 'LOW_BUDGET'
                    severity = 'CRITICAL'
                } else if (e.event_type === 'BUDGET_WARNING') {
                    type = 'BUDGET_WARNING'
                    severity = 'WARNING'
                } else {
                    // TASK_BLOCKED
                    type = 'TASK_BLOCKED'
                    severity = 'WARNING'
                }

                return {
                    id: e.id,
                    type,
                    message: e.description,
                    timestamp: e.timestamp,
                    severity,
                }
            })

        return {
            generated_at: new Date().toISOString(),
            sprint_id: sprint.id,
            task_board: tasks,
            pending_approvals: [...this._pendingApprovals],
            employee_registry: employees,
            budget_ledger: ledgerEntries,
            department_updates: departmentUpdates,
            activity_log: activityEntries,
            alerts,
        }
    }

    serialize(report: Report): string {
        return JSON.stringify(report)
    }

    deserialize(json: string): Report {
        return JSON.parse(json) as Report
    }
}
