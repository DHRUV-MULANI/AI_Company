import { describe, it, expect, beforeEach } from 'vitest'
import { EmployeeRegistry } from '../../../src/stores/employee-registry.js'
import type { Employee, OnboardingItem } from '../../../src/types.js'

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
    return {
        id: 'emp-1',
        name: 'Alice Smith',
        role: 'Engineer',
        department: 'Engineering',
        start_date: '2024-01-15T00:00:00.000Z',
        onboarding_status: 'IN_PROGRESS',
        onboarding_checklist: [],
        ...overrides,
    }
}

const ALL_STEPS = ['equipment_setup', 'system_access', 'orientation', 'role_briefing'] as const

describe('EmployeeRegistry', () => {
    let registry: EmployeeRegistry

    beforeEach(() => {
        registry = new EmployeeRegistry()
    })

    // ─── addEmployee ──────────────────────────────────────────────────────────

    describe('addEmployee', () => {
        it('returns the added employee', () => {
            const result = registry.addEmployee(makeEmployee())
            expect(result).toMatchObject({ id: 'emp-1', name: 'Alice Smith' })
        })

        it('stores the employee so getEmployee returns it', () => {
            registry.addEmployee(makeEmployee())
            expect(registry.getEmployee('emp-1')).not.toBeNull()
        })

        it('defaults onboarding_status to IN_PROGRESS when not provided', () => {
            const emp = makeEmployee()
            delete (emp as any).onboarding_status
            const result = registry.addEmployee(emp)
            expect(result.onboarding_status).toBe('IN_PROGRESS')
        })

        it('preserves provided onboarding_status', () => {
            const result = registry.addEmployee(makeEmployee({ onboarding_status: 'COMPLETED' }))
            expect(result.onboarding_status).toBe('COMPLETED')
        })

        it('adds all 4 required checklist steps when checklist is empty', () => {
            const result = registry.addEmployee(makeEmployee({ onboarding_checklist: [] }))
            const steps = result.onboarding_checklist.map(i => i.step)
            for (const step of ALL_STEPS) {
                expect(steps).toContain(step)
            }
        })

        it('adds missing required steps to a partial checklist', () => {
            const partial: OnboardingItem[] = [{ step: 'equipment_setup', completed: true }]
            const result = registry.addEmployee(makeEmployee({ onboarding_checklist: partial }))
            const steps = result.onboarding_checklist.map(i => i.step)
            for (const step of ALL_STEPS) {
                expect(steps).toContain(step)
            }
        })

        it('added missing steps have completed: false', () => {
            const partial: OnboardingItem[] = [{ step: 'equipment_setup', completed: true }]
            const result = registry.addEmployee(makeEmployee({ onboarding_checklist: partial }))
            const added = result.onboarding_checklist.filter(i => i.step !== 'equipment_setup')
            expect(added.every(i => i.completed === false)).toBe(true)
        })

        it('does not duplicate steps already present', () => {
            const full: OnboardingItem[] = ALL_STEPS.map(step => ({ step, completed: false }))
            const result = registry.addEmployee(makeEmployee({ onboarding_checklist: full }))
            expect(result.onboarding_checklist).toHaveLength(4)
        })

        it('preserves extra custom checklist steps', () => {
            const checklist: OnboardingItem[] = [{ step: 'custom_step', completed: false }]
            const result = registry.addEmployee(makeEmployee({ onboarding_checklist: checklist }))
            const steps = result.onboarding_checklist.map(i => i.step)
            expect(steps).toContain('custom_step')
        })

        it('returns a defensive copy — mutating result does not affect store', () => {
            registry.addEmployee(makeEmployee())
            const result = registry.addEmployee(makeEmployee({ id: 'emp-2' }))
            result.name = 'Mutated'
            expect(registry.getEmployee('emp-2')!.name).toBe('Alice Smith')
        })

        it.each(['id', 'name', 'role', 'department', 'start_date'] as const)(
            'throws when required field "%s" is missing',
            (field) => {
                const emp = makeEmployee({ [field]: '' as any })
                expect(() => registry.addEmployee(emp)).toThrow(field)
            }
        )

        it('throws when id is undefined', () => {
            const emp = makeEmployee()
            delete (emp as any).id
            expect(() => registry.addEmployee(emp)).toThrow('id')
        })
    })

    // ─── updateEmployee ───────────────────────────────────────────────────────

    describe('updateEmployee', () => {
        beforeEach(() => {
            registry.addEmployee(makeEmployee())
        })

        it('applies patch fields', () => {
            const result = registry.updateEmployee('emp-1', { role: 'Senior Engineer' })
            expect(result.role).toBe('Senior Engineer')
        })

        it('returns a defensive copy — mutating result does not affect store', () => {
            const result = registry.updateEmployee('emp-1', { name: 'Bob' })
            result.name = 'Mutated'
            expect(registry.getEmployee('emp-1')!.name).toBe('Bob')
        })

        it('throws when employee id does not exist', () => {
            expect(() => registry.updateEmployee('ghost', { name: 'X' })).toThrow(/ghost/)
        })

        it('does NOT auto-complete when some checklist items are still incomplete', () => {
            const checklist: OnboardingItem[] = [
                { step: 'equipment_setup', completed: true },
                { step: 'system_access', completed: false },
                { step: 'orientation', completed: false },
                { step: 'role_briefing', completed: false },
            ]
            const result = registry.updateEmployee('emp-1', { onboarding_checklist: checklist })
            expect(result.onboarding_status).toBe('IN_PROGRESS')
        })

        it('auto-sets onboarding_status to COMPLETED when all checklist items are completed', () => {
            const checklist: OnboardingItem[] = ALL_STEPS.map(step => ({
                step,
                completed: true,
                completed_at: '2024-02-01T00:00:00.000Z',
            }))
            const result = registry.updateEmployee('emp-1', { onboarding_checklist: checklist })
            expect(result.onboarding_status).toBe('COMPLETED')
        })

        it('auto-completion persists on subsequent reads', () => {
            const checklist: OnboardingItem[] = ALL_STEPS.map(step => ({ step, completed: true }))
            registry.updateEmployee('emp-1', { onboarding_checklist: checklist })
            expect(registry.getEmployee('emp-1')!.onboarding_status).toBe('COMPLETED')
        })

        it('preserves existing checklist when patch does not include onboarding_checklist', () => {
            const checklist: OnboardingItem[] = ALL_STEPS.map(step => ({ step, completed: false }))
            registry.updateEmployee('emp-1', { onboarding_checklist: checklist })
            const result = registry.updateEmployee('emp-1', { role: 'Lead' })
            expect(result.onboarding_checklist).toHaveLength(4)
        })
    })

    // ─── getEmployee ──────────────────────────────────────────────────────────

    describe('getEmployee', () => {
        it('returns null for unknown id', () => {
            expect(registry.getEmployee('nonexistent')).toBeNull()
        })

        it('returns the employee for a known id', () => {
            registry.addEmployee(makeEmployee())
            expect(registry.getEmployee('emp-1')).not.toBeNull()
        })

        it('returns a defensive copy — mutating it does not affect the store', () => {
            registry.addEmployee(makeEmployee())
            const emp = registry.getEmployee('emp-1')!
            emp.name = 'Mutated'
            expect(registry.getEmployee('emp-1')!.name).toBe('Alice Smith')
        })

        it('returns a copy with independent checklist — mutating it does not affect the store', () => {
            registry.addEmployee(makeEmployee())
            const emp = registry.getEmployee('emp-1')!
            emp.onboarding_checklist.push({ step: 'extra', completed: false })
            expect(registry.getEmployee('emp-1')!.onboarding_checklist).toHaveLength(4)
        })
    })

    // ─── getAllEmployees ───────────────────────────────────────────────────────

    describe('getAllEmployees', () => {
        it('returns empty array when no employees exist', () => {
            expect(registry.getAllEmployees()).toEqual([])
        })

        it('returns all added employees', () => {
            registry.addEmployee(makeEmployee({ id: 'e1' }))
            registry.addEmployee(makeEmployee({ id: 'e2' }))
            expect(registry.getAllEmployees()).toHaveLength(2)
        })

        it('returns defensive copies — mutating results does not affect the store', () => {
            registry.addEmployee(makeEmployee())
            const all = registry.getAllEmployees()
            all[0].name = 'Mutated'
            expect(registry.getEmployee('emp-1')!.name).toBe('Alice Smith')
        })
    })
})
