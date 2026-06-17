 # Implementation Plan: AI Company Operating System (COS)

## Overview

Implement the COS platform incrementally: core data models and types first, then shared state stores, then the write lock manager, then message queues, then the orchestrator, then each agent, then the report generator, then the sprint lifecycle, and finally integration wiring. Property-based tests (fast-check) are placed immediately after the component they validate.

## Tasks

- [x] 1. Project scaffolding and core TypeScript types
  - Initialize a TypeScript project with `tsconfig.json`, `package.json`, and install dependencies: `fast-check`, `vitest` (or `jest`), `uuid`
  - Create `src/types.ts` defining all shared types and interfaces: `AgentRole`, `AgentMessage`, `MessageType`, `Task`, `TaskStatus`, `TaskPriority`, `LedgerEntry`, `Employee`, `OnboardingItem`, `ActivityEntry`, `ActivityEventType`, `Sprint`, `Report`, `PendingApproval`, `DepartmentUpdate`, `Alert`, `SharedResource`, `LockToken`
  - Create `src/interfaces.ts` declaring all component interfaces: `COSOrchestrator`, `Agent`, `MessageQueue`, `TaskBoard`, `BudgetLedger`, `EmployeeRegistry`, `ActivityLog`, `WriteLockManager`, `ReportGenerator`
  - Set up `tests/` directory structure matching the design: `unit/agents/`, `unit/stores/`, `property/`, `integration/`
  - _Requirements: 1.1, 1.2, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

- [ ] 2. Message queue implementation
  - [x] 2.1 Implement `MessageQueue` class in `src/message-queue.ts`
    - FIFO array-backed queue with `enqueue`, `dequeue`, `peek`, `size`, `isEmpty`
    - _Requirements: 2.1, 2.2_

  - [ ]* 2.2 Write property test for message routing (Property 2)
    - **Property 2: Message routing delivers to correct queue only**
    - **Validates: Requirements 2.1**
    - File: `tests/property/message-queue.property.test.ts`

  - [ ]* 2.3 Write property test for FIFO ordering (Property 3)
    - **Property 3: Message queue preserves FIFO ordering**
    - **Validates: Requirements 2.2**
    - File: `tests/property/message-queue.property.test.ts`

  - [ ]* 2.4 Write unit tests for MessageQueue
    - Test enqueue/dequeue, peek on empty queue, size tracking
    - File: `tests/unit/stores/message-queue.test.ts`

- [ ] 3. Write lock manager
  - [x] 3.1 Implement `WriteLockManager` class in `src/write-lock-manager.ts`
    - Exclusive per-resource locks with `acquire`, `release`, `isLocked`
    - Configurable timeout; on timeout abort and log `LOCK_TIMEOUT`
    - _Requirements: 10.5_

  - [ ]* 3.2 Write property test for lock acquisition audit (Property 34)
    - **Property 34: Shared state mutations are always preceded by lock acquisition**
    - **Validates: Requirements 10.5**
    - File: `tests/property/agent-behavior.property.test.ts`

  - [ ]* 3.3 Write unit tests for WriteLockManager
    - Test acquire/release, contention timeout, `isLocked` state
    - File: `tests/unit/stores/write-lock-manager.test.ts`

- [ ] 4. Activity log store
  - [x] 4.1 Implement `ActivityLog` class in `src/stores/activity-log.ts`
    - Append-only in-memory array; `append`, `getAll`, `getEntriesSince`
    - Validate all required fields on append; sort by timestamp on read
    - _Requirements: 7.1, 7.2, 7.5_

  - [ ]* 4.2 Write property test for activity log required fields (Property 21)
    - **Property 21: Activity log entries have all required fields**
    - **Validates: Requirements 7.1**
    - File: `tests/property/activity-log.property.test.ts`

  - [ ]* 4.3 Write property test for activity log immutability (Property 22)
    - **Property 22: Activity log is append-only (immutability invariant)**
    - **Validates: Requirements 7.2**
    - File: `tests/property/activity-log.property.test.ts`

  - [ ]* 4.4 Write property test for chronological ordering (Property 25)
    - **Property 25: Activity log query returns all entries in chronological order**
    - **Validates: Requirements 7.5**
    - File: `tests/property/activity-log.property.test.ts`

  - [ ]* 4.5 Write unit tests for ActivityLog
    - Test append, getAll ordering, getEntriesSince filtering
    - File: `tests/unit/stores/activity-log.test.ts`

- [ ] 5. Task board store
  - [x] 5.1 Implement `TaskBoard` class in `src/stores/task-board.ts`
    - `createTask`, `updateTask`, `getTask`, `getAllTasks`, `getTasksByStatus`
    - Enforce task state machine transitions; reject and log invalid ones
    - Validate all required fields on creation; set `created_at` and `updated_at`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

  - [ ]* 5.2 Write property test for task required fields (Property 8)
    - **Property 8: Created tasks have all required fields**
    - **Validates: Requirements 4.1**
    - File: `tests/property/task-lifecycle.property.test.ts`

  - [ ]* 5.3 Write property test for task state machine (Property 9)
    - **Property 9: Task state machine enforces valid transitions and rejects invalid ones**
    - **Validates: Requirements 4.2, 4.3**
    - File: `tests/property/task-lifecycle.property.test.ts`

  - [ ]* 5.4 Write property test for task completion timestamp (Property 10)
    - **Property 10: Task completion sets status and timestamp**
    - **Validates: Requirements 4.4**
    - File: `tests/property/task-lifecycle.property.test.ts`

  - [ ]* 5.5 Write property test for task board query consistency (Property 12)
    - **Property 12: Task board query returns all tasks with current status**
    - **Validates: Requirements 4.6**
    - File: `tests/property/task-lifecycle.property.test.ts`

  - [ ]* 5.6 Write unit tests for TaskBoard
    - Test create, valid/invalid transitions, query by status, blocker reason
    - File: `tests/unit/stores/task-board.test.ts`

- [ ] 6. Budget ledger store
  - [x] 6.1 Implement `BudgetLedger` class in `src/stores/budget-ledger.ts`
    - Append-only; `append`, `getBalance`, `getAll`, `getEntriesSince`
    - Compute `running_balance` on each append (sum of prior net amounts + current)
    - Reject overdraft (amount > running_balance for DEBITs); log rejection
    - Emit `BUDGET_ALERT` when balance falls below configurable threshold
    - Sort entries by timestamp on read
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.2 Write property test for ledger entry required fields (Property 13)
    - **Property 13: Committed ledger entries have all required fields**
    - **Validates: Requirements 5.1**
    - File: `tests/property/budget-ledger.property.test.ts`

  - [ ]* 6.3 Write property test for ledger immutability (Property 14)
    - **Property 14: Budget ledger is append-only (immutability invariant)**
    - **Validates: Requirements 5.2**
    - File: `tests/property/budget-ledger.property.test.ts`

  - [ ]* 6.4 Write property test for running balance correctness (Property 15)
    - **Property 15: Running balance is always mathematically correct**
    - **Validates: Requirements 5.3**
    - File: `tests/property/budget-ledger.property.test.ts`

  - [ ]* 6.5 Write property test for low-balance alert (Property 16)
    - **Property 16: Low-balance threshold crossing emits alert**
    - **Validates: Requirements 5.4**
    - File: `tests/property/budget-ledger.property.test.ts`

  - [ ]* 6.6 Write property test for overdraft prevention (Property 17)
    - **Property 17: Overdraft prevention rejects and logs**
    - **Validates: Requirements 5.5**
    - File: `tests/property/budget-ledger.property.test.ts`

  - [ ]* 6.7 Write property test for chronological ledger query (Property 18)
    - **Property 18: Ledger query returns all entries in chronological order**
    - **Validates: Requirements 5.6**
    - File: `tests/property/budget-ledger.property.test.ts`

  - [ ]* 6.8 Write unit tests for BudgetLedger
    - Test credit/debit, overdraft rejection, alert threshold, getEntriesSince
    - File: `tests/unit/stores/budget-ledger.test.ts`

- [ ] 7. Employee registry store
  - [x] 7.1 Implement `EmployeeRegistry` class in `src/stores/employee-registry.ts`
    - `addEmployee`, `updateEmployee`, `getEmployee`, `getAllEmployees`
    - Validate required fields on add; set `onboarding_status` to `IN_PROGRESS`
    - Auto-complete `onboarding_status` to `COMPLETED` when all checklist items done
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 7.2 Write property test for new employee required fields and initial state (Property 19)
    - **Property 19: New employees have all required fields and correct initial onboarding state**
    - **Validates: Requirements 6.1, 6.2, 6.3**
    - File: `tests/property/employee-registry.property.test.ts`

  - [ ]* 7.3 Write property test for onboarding completion (Property 20)
    - **Property 20: Completing all onboarding items sets status to COMPLETED**
    - **Validates: Requirements 6.4**
    - File: `tests/property/employee-registry.property.test.ts`

  - [ ]* 7.4 Write unit tests for EmployeeRegistry
    - Test add, update, onboarding checklist completion, queryability
    - File: `tests/unit/stores/employee-registry.test.ts`

- [x] 8. Checkpoint — Ensure all store tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Sprint store
  - [x] 9.1 Implement `SprintStore` class in `src/stores/sprint-store.ts`
    - `createSprint`, `getActiveSprint`, `completeSprint`, `getAll`
    - Enforce single ACTIVE sprint at a time
    - Track expenditures per sprint; emit `BUDGET_WARNING` at 80% utilization
    - _Requirements: 9.1, 9.3, 9.4, 9.5_

  - [ ]* 9.2 Write property test for sprint required fields (Property 28)
    - **Property 28: Sprint objects have all required fields**
    - **Validates: Requirements 9.1**
    - File: `tests/property/sprint.property.test.ts`

  - [ ]* 9.3 Write property test for sprint rollover (Property 29)
    - **Property 29: Sprint end rolls over incomplete tasks and initializes new sprint**
    - **Validates: Requirements 9.2**
    - File: `tests/property/sprint.property.test.ts`

  - [ ]* 9.4 Write property test for sprint expenditure tracking (Property 30)
    - **Property 30: Sprint expenditure tracking matches ledger DEBITs**
    - **Validates: Requirements 9.3**
    - File: `tests/property/sprint.property.test.ts`

  - [ ]* 9.5 Write property test for 80% budget warning (Property 31)
    - **Property 31: 80% budget utilization triggers warning alert**
    - **Validates: Requirements 9.4**
    - File: `tests/property/sprint.property.test.ts`

  - [ ]* 9.6 Write property test for task creation without active sprint (Property 32)
    - **Property 32: Task creation without active sprint is rejected and logged**
    - **Validates: Requirements 9.5**
    - File: `tests/property/sprint.property.test.ts`

  - [ ]* 9.7 Write unit tests for SprintStore
    - Test create, complete, rollover, expenditure tracking, 80% alert
    - File: `tests/unit/sprint.test.ts`

- [ ] 10. Report generator
  - [x] 10.1 Implement `ReportGenerator` class in `src/report-generator.ts`
    - `generate(sprint)` assembles snapshot from all stores
    - `serialize(report)` → JSON string; `deserialize(json)` → Report
    - Populate all seven required sections; include `generated_at` and `sprint_id`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 10.2 Write property test for report completeness (Property 26)
    - **Property 26: Generated report contains all required sections with current data**
    - **Validates: Requirements 8.1, 8.2, 8.4**
    - File: `tests/property/report.property.test.ts`

  - [ ]* 10.3 Write property test for report serialization round-trip (Property 27)
    - **Property 27: Report serialization round-trip preserves equivalence**
    - **Validates: Requirements 8.3, 8.5**
    - File: `tests/property/report.property.test.ts`

  - [ ]* 10.4 Write unit tests for ReportGenerator
    - Test generate with known state, serialize/deserialize, alert population
    - File: `tests/unit/report-generator.test.ts`

- [ ] 11. Agent base and CEO agent
  - [x] 11.1 Implement abstract `BaseAgent` class in `src/agents/base-agent.ts`
    - Shared `role`, `initialize`, `processMessage`, `tick`, `getOutboundQueue` contract
    - Inject shared stores and write lock manager via constructor
    - Log every action to ActivityLog within the same processing cycle
    - _Requirements: 1.2, 7.3_

  - [x] 11.2 Implement `CEOAgent` in `src/agents/ceo-agent.ts`
    - Process `APPROVAL_REQUEST` messages: approve or reject hires and expenses >$500
    - On approval: emit `APPROVAL_RESPONSE` with approved=true; log `APPROVAL_GRANTED`
    - On rejection: emit `APPROVAL_RESPONSE` with approved=false and reason; log `APPROVAL_REJECTED`
    - `tick()`: self-assign unassigned CEO-domain tasks; escalate unresolved blockers
    - _Requirements: 3.4, 3.5, 10.1, 10.2_

  - [ ]* 11.3 Write property test for agent init failure logging (Property 1)
    - **Property 1: Agent initialization failure is logged and halts startup**
    - **Validates: Requirements 1.4**
    - File: `tests/property/agent-behavior.property.test.ts`

  - [ ]* 11.4 Write unit tests for CEOAgent
    - Test approval grant, approval rejection, blocker escalation, tick self-assignment
    - File: `tests/unit/agents/ceo.test.ts`

- [ ] 12. HR, Finance, CTO, Operations, and Marketing agents
  - [x] 12.1 Implement `HRAgent` in `src/agents/hr-agent.ts`
    - On hire intent: enqueue `HIRE_REQUEST` approval to CEO queue; hold task PENDING
    - On `APPROVAL_RESPONSE` approved: add employee to registry with checklist; log `EMPLOYEE_ADDED`
    - On `APPROVAL_RESPONSE` rejected: set task BLOCKED with reason
    - `tick()`: complete onboarding checklist items; set `COMPLETED` when all done
    - _Requirements: 3.1, 6.2, 6.3, 6.4, 10.1_

  - [x] 12.2 Implement `FinanceAgent` in `src/agents/finance-agent.ts`
    - On expense ≤$500: acquire lock, append to ledger, release lock; log `EXPENSE_COMMITTED`
    - On expense >$500: enqueue `EXPENSE_REQUEST` approval to CEO queue; hold task PENDING
    - On `APPROVAL_RESPONSE` approved: commit transaction; on rejected: set task BLOCKED
    - Overdraft check before any commit; emit `BUDGET_ALERT` on threshold crossing
    - _Requirements: 3.2, 5.3, 5.4, 5.5, 10.1_

  - [x] 12.3 Implement `CTOAgent` in `src/agents/cto-agent.ts`
    - `tick()`: self-assign unassigned engineering tasks; escalate technical blockers to CEO
    - Process `TASK_ASSIGNMENT` and `BLOCKER_RESOLUTION` messages
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 12.4 Implement `OperationsAgent` in `src/agents/operations-agent.ts`
    - `tick()`: self-assign cross-department coordination tasks; escalate blockers
    - Process `BLOCKER_ESCALATION` messages; resolve or forward to CEO/CTO
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 12.5 Implement `MarketingAgent` in `src/agents/marketing-agent.ts`
    - `tick()`: self-assign marketing campaign tasks; request budget via Finance
    - Process `APPROVAL_RESPONSE` for campaign expenses
    - _Requirements: 10.1, 10.2_

  - [ ]* 12.6 Write property test for approval chain enforcement (Property 5)
    - **Property 5: Approval chain enforced before hire or high-value expense is committed**
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.6**
    - File: `tests/property/approval-chain.property.test.ts`

  - [ ]* 12.7 Write property test for pending approval holds task (Property 6)
    - **Property 6: Pending approval holds task in PENDING and surfaces in report**
    - **Validates: Requirements 3.3**
    - File: `tests/property/approval-chain.property.test.ts`

  - [ ]* 12.8 Write property test for CEO rejection blocks task (Property 7)
    - **Property 7: CEO rejection blocks task with reason and is logged**
    - **Validates: Requirements 3.5**
    - File: `tests/property/approval-chain.property.test.ts`

  - [ ]* 12.9 Write property test for blocker escalation routing (Property 11)
    - **Property 11: Blocker identification sets task BLOCKED and routes escalation**
    - **Validates: Requirements 4.5, 10.2**
    - File: `tests/property/task-lifecycle.property.test.ts`

  - [ ]* 12.10 Write property test for every agent action produces a log entry (Property 23)
    - **Property 23: Every agent action produces a log entry**
    - **Validates: Requirements 7.3**
    - File: `tests/property/activity-log.property.test.ts`

  - [ ]* 12.11 Write property test for task state transitions fully audited (Property 24)
    - **Property 24: Task state transitions are fully audited in the log**
    - **Validates: Requirements 7.4**
    - File: `tests/property/activity-log.property.test.ts`

  - [ ]* 12.12 Write unit tests for HRAgent, FinanceAgent, CTOAgent, OperationsAgent, MarketingAgent
    - Test each agent's approval flow, tick behavior, and blocker escalation
    - Files: `tests/unit/agents/hr.test.ts`, `finance.test.ts`, `cto.test.ts`, `operations.test.ts`, `marketing.test.ts`

- [x] 13. Checkpoint — Ensure all agent and approval chain tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. COS Orchestrator
  - [x] 14.1 Implement `COSOrchestrator` class in `src/orchestrator.ts`
    - Instantiate all six agents and their message queues at `start()`
    - Route outbound messages from each agent to the correct recipient queue
    - Manage sprint lifecycle: `startSprint`, `tick` (process all agent queues), `endSprint` (rollover)
    - `stop()` halts all agents cleanly
    - On agent init failure: log `AGENT_INIT_FAILED` to ActivityLog and throw
    - _Requirements: 1.1, 1.3, 1.4, 2.1, 2.3, 9.2_

  - [x] 14.2 Wire `generateReport`, `getTaskBoard`, `getBudgetLedger`, `getEmployeeRegistry`, `getActivityLog`, `getCurrentSprint` on the orchestrator
    - Delegate to ReportGenerator and respective stores
    - _Requirements: 8.1, 8.2_

  - [ ]* 14.3 Write property test for undeliverable message handling (Property 4)
    - **Property 4: Undeliverable messages block originating task and are logged**
    - **Validates: Requirements 2.4**
    - File: `tests/property/message-queue.property.test.ts`

  - [ ]* 14.4 Write property test for inconsistency detection and self-correction (Property 33)
    - **Property 33: Inconsistency detection triggers log and self-correction attempt**
    - **Validates: Requirements 10.4**
    - File: `tests/property/agent-behavior.property.test.ts`

  - [ ]* 14.5 Write unit tests for COSOrchestrator
    - Test start/stop, message routing, sprint lifecycle, init failure halting
    - File: `tests/unit/orchestrator.test.ts`

- [ ] 15. Integration tests
  - [x] 15.1 Write sprint cycle integration test in `tests/integration/sprint-cycle.integration.test.ts`
    - Scenario: start orchestrator, run one full sprint tick, verify agents self-assign tasks, messages are processed within the sprint cycle, blockers are escalated and resolved
    - _Requirements: 2.3, 10.1, 10.3_

  - [x] 15.2 Write full simulation integration test in `tests/integration/full-simulation.integration.test.ts`
    - Scenario: multi-sprint run with hire approval, expense approval, overdraft rejection, sprint rollover, and report generation
    - Verify end-to-end state consistency across all stores
    - _Requirements: 1.1, 3.1, 3.2, 5.5, 9.2, 8.1_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check with a minimum of 100 iterations per property (`{ numRuns: 100 }`)
- Each property test file must include the tag comment: `// Feature: ai-company-os, Property N: <property_text>`
- Checkpoints ensure incremental validation before moving to the next layer
- All 34 correctness properties from the design document are covered by property sub-tasks
