// ─── Agent Roles ────────────────────────────────────────────────────────────

export type AgentRole = 'CEO' | 'CTO' | 'HR' | 'Finance' | 'Operations' | 'Marketing'

// ─── Message Types ───────────────────────────────────────────────────────────

export type MessageType =
  | 'TASK_ASSIGNMENT'
  | 'APPROVAL_REQUEST'
  | 'APPROVAL_RESPONSE'
  | 'BLOCKER_ESCALATION'
  | 'BLOCKER_RESOLUTION'
  | 'BUDGET_ALERT'
  | 'STATUS_UPDATE'
  | 'HIRE_REQUEST'
  | 'EXPENSE_REQUEST'

export interface AgentMessage {
  id: string
  from: AgentRole
  to: AgentRole
  type: MessageType
  payload: Record<string, unknown>
  timestamp: string        // ISO 8601
  correlationId?: string   // links approval responses to requests
}

// ─── Task ────────────────────────────────────────────────────────────────────

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface Task {
  id: string
  title: string
  owner: AgentRole
  status: TaskStatus
  priority: TaskPriority
  created_at: string       // ISO 8601
  updated_at: string       // ISO 8601
  sprint_id: string
  blocker_reason?: string
}

// ─── Budget Ledger ───────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: string
  description: string
  amount: number           // always positive
  type: 'CREDIT' | 'DEBIT'
  agent_role: AgentRole
  timestamp: string        // ISO 8601
  running_balance: number
  sprint_id: string
}

// ─── Employee Registry ───────────────────────────────────────────────────────

export interface OnboardingItem {
  step: 'equipment_setup' | 'system_access' | 'orientation' | 'role_briefing' | string
  completed: boolean
  completed_at?: string    // ISO 8601
}

export interface Employee {
  id: string
  name: string
  role: string
  department: string
  start_date: string       // ISO 8601
  onboarding_status: 'IN_PROGRESS' | 'COMPLETED'
  onboarding_checklist: OnboardingItem[]
}

// ─── Activity Log ────────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'TASK_CREATED'
  | 'TASK_STATE_CHANGED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'EXPENSE_COMMITTED'
  | 'EXPENSE_REJECTED'
  | 'EMPLOYEE_ADDED'
  | 'ONBOARDING_COMPLETED'
  | 'BLOCKER_RAISED'
  | 'BLOCKER_RESOLVED'
  | 'BUDGET_ALERT'
  | 'SPRINT_STARTED'
  | 'SPRINT_COMPLETED'
  | 'AGENT_INIT_FAILED'
  | 'LOCK_ACQUIRED'
  | 'LOCK_RELEASED'
  | 'LOCK_TIMEOUT'
  | 'INCONSISTENCY_DETECTED'
  | 'SELF_CORRECTION_ATTEMPTED'
  | 'BUDGET_WARNING'
  | 'MESSAGE_DELIVERY_FAILED'
  | 'INVALID_TASK_TRANSITION'

export interface ActivityEntry {
  id: string
  timestamp: string        // ISO 8601
  agent_role: AgentRole
  event_type: ActivityEventType
  description: string
  metadata?: Record<string, unknown>
}

// ─── Sprint ──────────────────────────────────────────────────────────────────

export interface Sprint {
  id: string
  start_date: string       // ISO 8601
  end_date: string         // ISO 8601
  budget_allocation: number
  status: 'ACTIVE' | 'COMPLETED'
}

// ─── Report ──────────────────────────────────────────────────────────────────

export interface PendingApproval {
  task_id: string
  request_type: 'HIRE' | 'EXPENSE'
  requested_by: AgentRole
  requested_at: string     // ISO 8601
  payload: Record<string, unknown>
}

export interface DepartmentUpdate {
  agent_role: AgentRole
  summary: string
  tasks_completed: number
  tasks_in_progress: number
  tasks_blocked: number
}

export interface Alert {
  id: string
  type: 'LOW_BUDGET' | 'BUDGET_WARNING' | 'TASK_BLOCKED' | 'APPROVAL_PENDING'
  message: string
  timestamp: string        // ISO 8601
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
}

export interface Report {
  generated_at: string     // ISO 8601
  sprint_id: string
  task_board: Task[]
  pending_approvals: PendingApproval[]
  employee_registry: Employee[]
  budget_ledger: LedgerEntry[]
  department_updates: DepartmentUpdate[]
  activity_log: ActivityEntry[]
  alerts: Alert[]
}

// ─── Write Lock ──────────────────────────────────────────────────────────────

export type SharedResource = 'budget_ledger' | 'employee_registry' | 'activity_log' | 'task_board'

export interface LockToken {
  resource: SharedResource
  holder: AgentRole
  acquired_at: string      // ISO 8601
  token_id: string
}
