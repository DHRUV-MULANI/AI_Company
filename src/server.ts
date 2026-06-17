import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { COSOrchestrator } from './orchestrator.js'
import type { AgentMessage, AgentRole, Employee, LedgerEntry } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// ─── Bootstrap the COS ───────────────────────────────────────────────────────

const cos = new COSOrchestrator()
cos.start()

// Seed initial budget credit so expenses can be processed
const ledger = (cos as any)._budgetLedger
const sprint = cos.getCurrentSprint()
ledger.append({
    id: randomUUID(),
    description: 'Initial capital deposit',
    amount: 10000,
    type: 'CREDIT',
    agent_role: 'Finance',
    timestamp: new Date().toISOString(),
    running_balance: 0,
    sprint_id: sprint.id,
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function injectMessage(to: AgentRole, msg: Partial<AgentMessage>) {
    const queues: Map<string, { enqueue: (m: AgentMessage) => void }> = (cos as any)._queues
    const queue = queues.get(to)
    if (!queue) throw new Error(`Unknown agent: ${to}`)
    queue.enqueue({
        id: randomUUID(),
        from: 'CEO',
        to,
        type: 'STATUS_UPDATE',
        payload: {},
        timestamp: new Date().toISOString(),
        ...msg,
    } as AgentMessage)
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /report — full company state snapshot
app.get('/report', (_req, res) => {
    res.json(cos.generateReport())
})

// GET /sprint — current sprint
app.get('/sprint', (_req, res) => {
    res.json(cos.getCurrentSprint())
})

// GET /tasks — task board
app.get('/tasks', (_req, res) => {
    res.json(cos.getTaskBoard())
})

// GET /budget — budget ledger
app.get('/budget', (_req, res) => {
    res.json(cos.getBudgetLedger())
})

// GET /employees — employee registry
app.get('/employees', (_req, res) => {
    res.json(cos.getEmployeeRegistry())
})

// GET /log — activity log (last 50)
app.get('/log', (_req, res) => {
    const log = cos.getActivityLog()
    res.json(log.slice(-50).reverse())
})

// POST /tick — advance one sprint cycle
app.post('/tick', (_req, res) => {
    cos.tick()
    res.json({ ok: true, sprint: cos.getCurrentSprint() })
})

// POST /hire — trigger a hire request through HR
app.post('/hire', (req, res) => {
    const { name, role, department } = req.body
    if (!name || !role || !department) {
        return res.status(400).json({ error: 'name, role, department required' })
    }
    const employee: Employee = {
        id: randomUUID(),
        name,
        role,
        department,
        start_date: new Date().toISOString(),
        onboarding_status: 'IN_PROGRESS',
        onboarding_checklist: [
            { step: 'equipment_setup', completed: false },
            { step: 'system_access', completed: false },
            { step: 'orientation', completed: false },
            { step: 'role_briefing', completed: false },
        ],
    }
    injectMessage('HR', {
        from: 'CEO',
        to: 'HR',
        type: 'HIRE_REQUEST',
        payload: { employeeData: employee },
    })
    // Run 3 ticks: HR→CEO approval→HR adds employee
    cos.tick(); cos.tick(); cos.tick()
    res.json({ ok: true, employee })
})

// POST /expense — submit an expense through Finance
app.post('/expense', (req, res) => {
    const { description, amount } = req.body
    if (!description || !amount) {
        return res.status(400).json({ error: 'description and amount required' })
    }
    const sprintId = cos.getCurrentSprint().id
    const expenseData: LedgerEntry = {
        id: randomUUID(),
        description,
        amount: Number(amount),
        type: 'DEBIT',
        agent_role: 'Finance',
        timestamp: new Date().toISOString(),
        running_balance: 0,
        sprint_id: sprintId,
    }
    injectMessage('Finance', {
        from: 'CEO',
        to: 'Finance',
        type: 'EXPENSE_REQUEST',
        payload: { amount: Number(amount), description, sprint_id: sprintId, expenseData },
    })
    // Run 3 ticks to complete approval flow
    cos.tick(); cos.tick(); cos.tick()
    res.json({ ok: true, expenseData })
})

// POST /task — create a task on the board
app.post('/task', (req, res) => {
    const { title, owner, priority } = req.body
    if (!title || !owner) {
        return res.status(400).json({ error: 'title and owner required' })
    }
    const taskBoard = (cos as any)._taskBoard
    const task = taskBoard.createTask({
        id: randomUUID(),
        title,
        owner: owner as AgentRole,
        status: 'PENDING',
        priority: priority ?? 'MEDIUM',
        sprint_id: cos.getCurrentSprint().id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    })
    res.json({ ok: true, task })
})

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = 3000
app.listen(PORT, () => {
    console.log(`\n🏢 AI Company OS running at http://localhost:${PORT}\n`)
})
