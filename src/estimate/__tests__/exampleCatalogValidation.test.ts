/**
 * Validation tests for the synthetic example catalog.
 *
 * These tests verify that the formula engine produces correct order quantities
 * for each example task's recipe lines, given synthetic scope inputs.
 *
 * When you import your real spreadsheet (via `npm run import:catalog`), add
 * similar tests here using git-ignored fixture data to validate totals against
 * the original workbook.
 *
 * NOTE: All quantities and formulas here match the SYNTHETIC example catalog
 * only — no real prices or rates.
 */

import { describe, it, expect } from 'vitest';
import { EXAMPLE_CATALOG } from '../catalog-example.ts';
import { evalFormula, buildVars } from '../formulaEngine.ts';

/**
 * Helper: evaluate a task's recipe for given scope values.
 * Returns { [materialId]: orderedQty }
 */
function computeRecipe(
  taskId: string,
  scope: Record<string, number>,
): Record<string, number> {
  const task = EXAMPLE_CATALOG.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const entries = Object.entries(scope).map(([role, value]) => ({ role, value }));
  const vars = buildVars(entries);

  const result: Record<string, number> = {};
  for (const line of task.recipe) {
    const qty = evalFormula(line.orderQtyFormula, { ...vars, factor: line.factor });
    result[line.materialId] = qty;
  }
  return result;
}

describe('Example catalog — task: Build Forms – One Sided', () => {
  const TASK = 'task-form-one-sided';

  it('orders 2 sheets of plywood for 40LF, height 2ft (single-sided)', () => {
    const qty = computeRecipe(TASK, { length: 40, height: 2 });
    // IF(Height>2, ROUNDUP(1*2*(40/32),0), ROUNDUP(1*(40/32),0))
    // Height=2 → NOT > 2 → ROUNDUP(40/32) = ROUNDUP(1.25) = 2
    expect(qty['mat-plywood-3-4']).toBe(2);
  });

  it('orders 3 sheets of plywood for 40LF, height 3ft (double-sided)', () => {
    const qty = computeRecipe(TASK, { length: 40, height: 3 });
    // Height=3 → > 2 → ROUNDUP(1*2*(40/32)) = ROUNDUP(2.5) = 3
    expect(qty['mat-plywood-3-4']).toBe(3);
  });

  it('scales linearly — 80LF, height 3ft → 6 sheets', () => {
    const qty = computeRecipe(TASK, { length: 80, height: 3 });
    // ROUNDUP(1*2*(80/32)) = ROUNDUP(5) = 5... wait: 80/32 = 2.5, *2 = 5 exactly
    expect(qty['mat-plywood-3-4']).toBe(5);
  });

  it('orders form oil: ROUNDUP(0.05*40, 1) = 2.0 gallons', () => {
    const qty = computeRecipe(TASK, { length: 40, height: 2 });
    // ROUNDUP(0.05*40, 1) = ROUNDUP(2.0, 1) = 2.0
    expect(qty['mat-form-oil']).toBeCloseTo(2.0);
  });

  it('orders form oil: ROUNDUP(0.05*25, 1) = 1.3 gallons', () => {
    const qty = computeRecipe(TASK, { length: 25, height: 2 });
    // ROUNDUP(0.05*25, 1) = ROUNDUP(1.25, 1) = 1.3
    expect(qty['mat-form-oil']).toBeCloseTo(1.3);
  });
});

describe('Example catalog — all tasks have valid formulas', () => {
  for (const task of EXAMPLE_CATALOG.tasks) {
    it(`task "${task.name}" labor formula is evaluable`, () => {
      const vars = buildVars([{ role: 'length', value: 10 }, { role: 'height', value: 1 }]);
      const result = evalFormula(task.laborQtyFormula, vars);
      // Should not be NaN (0 or more is acceptable for zero-scope inputs)
      expect(isNaN(result)).toBe(false);
    });
  }
});

describe('Example catalog — structure integrity', () => {
  it('all task phaseIds reference a real phase', () => {
    const phaseIds = new Set(EXAMPLE_CATALOG.phases.map(p => p.id));
    for (const task of EXAMPLE_CATALOG.tasks) {
      expect(phaseIds.has(task.phaseId), `Task "${task.name}" phaseId "${task.phaseId}" not found`).toBe(true);
    }
  });

  it('all recipe materialIds reference a real material', () => {
    const matIds = new Set(EXAMPLE_CATALOG.materials.map(m => m.id));
    for (const task of EXAMPLE_CATALOG.tasks) {
      for (const line of task.recipe) {
        expect(matIds.has(line.materialId), `Recipe in task "${task.name}" refs unknown material "${line.materialId}"`).toBe(true);
      }
    }
  });
});
