import type {
  AgentMessage,
  AgentRole,
  ActivityEntry,
  Employee,
  LedgerEntry,
  LockToken,
  Report,
  SharedResource,
  Sprint,
  Task,
  TaskStatus,
} from './types.js'

// ─── COS Orchestrator ────────────────────────────────────────────────────────

export interface COSOrchestrator {
  start(): void
  stop(): void
  generateReport(): Report
  getCurrentSprint(): Sprint
  getTaskBoard(): Task[]
  getBudgetLedger(): LedgerEntry[]
  getEmployeeRegistry(): Employee[]
  getActivityLog(): ActivityEntry[]
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface Agent {
  role: AgentRole
  initialize(): void
  processMessage(msg: AgentMessage): AgentMessage[]
  tick(): AgentMessage[]
  getOutboundQueue(): AgentMessage[]
}

// ─── Message Queue ───────────────────────────────────────────────────────────

export interface MessageQueue {
  enqueue(msg: AgentMessage): void
  dequeue(): AgentMessage | null
  peek(): AgentMessage | null
  size(): number
  isEmpty(): boolean
}

// ─── Task Board ──────────────────────────────────────────────────────────────

export interface TaskBoard {
  createTask(task: Task): Task
  updateTask(id: string, patch: Partial<Task>): Task
  getTask(id: string): Task | null
  getAllTasks(): Task[]
  getTasksByStatus(status: TaskStatus): Task[]
}

// ─── Budget Ledger ───────────────────────────────────────────────────────────

export interface BudgetLedger {
  append(entry: LedgerEntry): LedgerEntry
  getBalance(): number
  getAll(): LedgerEntry[]
  getEntriesSince(timestamp: string): LedgerEntry[]
}

// ─── Employee Registry ───────────────────────────────────────────────────────

export interface EmployeeRegistry {
  addEmployee(employee: Employee): Employee
  updateEmployee(id: string, patch: Partial<Employee>): Employee
  getEmployee(id: string): Employee | null
  getAllEmployees(): Employee[]
}

// ─── Activity Log ────────────────────────────────────────────────────────────

export interface ActivityLog {
  append(entry: ActivityEntry): ActivityEntry
  getAll(): ActivityEntry[]
  getEntriesSince(timestamp: string): ActivityEntry[]
}

// ─── Write Lock Manager ──────────────────────────────────────────────────────

export interface WriteLockManager {
  acquire(resource: SharedResource, agentRole: AgentRole): LockToken
  release(token: LockToken): void
  isLocked(resource: SharedResource): boolean
}

// ─── Report Generator ────────────────────────────────────────────────────────

export interface ReportGenerator {
  generate(sprint: Sprint): Report
  serialize(report: Report): string
  deserialize(json: string): Report
}
