import type { Employee, OnboardingItem } from '../types.js'
import type { EmployeeRegistry as IEmployeeRegistry } from '../interfaces.js'

const REQUIRED_FIELDS: (keyof Employee)[] = ['id', 'name', 'role', 'department', 'start_date']

const REQUIRED_STEPS: OnboardingItem['step'][] = [
    'equipment_setup',
    'system_access',
    'orientation',
    'role_briefing',
]

function ensureRequiredSteps(checklist: OnboardingItem[]): OnboardingItem[] {
    const existing = new Set(checklist.map(item => item.step))
    const result = [...checklist]
    for (const step of REQUIRED_STEPS) {
        if (!existing.has(step)) {
            result.push({ step, completed: false })
        }
    }
    return result
}

function allChecklistCompleted(checklist: OnboardingItem[]): boolean {
    return checklist.length > 0 && checklist.every(item => item.completed)
}

function copyEmployee(employee: Employee): Employee {
    return {
        ...employee,
        onboarding_checklist: employee.onboarding_checklist.map(item => ({ ...item })),
    }
}

export class EmployeeRegistry implements IEmployeeRegistry {
    private readonly _employees = new Map<string, Employee>()

    addEmployee(employee: Employee): Employee {
        for (const field of REQUIRED_FIELDS) {
            const value = employee[field]
            if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
                throw new Error(`Employee missing required field: ${field}`)
            }
        }

        const checklist = ensureRequiredSteps(employee.onboarding_checklist ?? [])
        const stored: Employee = {
            ...employee,
            onboarding_status: employee.onboarding_status ?? 'IN_PROGRESS',
            onboarding_checklist: checklist,
        }

        this._employees.set(stored.id, stored)
        return copyEmployee(stored)
    }

    updateEmployee(id: string, patch: Partial<Employee>): Employee {
        const existing = this._employees.get(id)
        if (!existing) {
            throw new Error(`Employee not found: ${id}`)
        }

        const updated: Employee = {
            ...existing,
            ...patch,
            onboarding_checklist: patch.onboarding_checklist
                ? patch.onboarding_checklist.map(item => ({ ...item }))
                : existing.onboarding_checklist.map(item => ({ ...item })),
        }

        // Auto-complete onboarding if all checklist items are done
        if (allChecklistCompleted(updated.onboarding_checklist)) {
            updated.onboarding_status = 'COMPLETED'
        }

        this._employees.set(id, updated)
        return copyEmployee(updated)
    }

    getEmployee(id: string): Employee | null {
        const employee = this._employees.get(id)
        return employee ? copyEmployee(employee) : null
    }

    getAllEmployees(): Employee[] {
        return Array.from(this._employees.values()).map(copyEmployee)
    }
}
