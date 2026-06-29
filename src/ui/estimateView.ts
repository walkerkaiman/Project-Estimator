/**
 * Estimate workspace view.
 *
 * Renders phases, tasks, scope inputs, and live computed totals
 * in the main content area.
 */

import { appState } from '../appState.ts';
import { evalFormula, buildVars } from '../estimate/formulaEngine.ts';
import type { Task, RecipeLine } from '../estimate/catalog.ts';
import type { ScopeEntry } from '../estimate/project.ts';

export function initEstimateUI(): void {
  appState.on('project-new', render);
  appState.on('project-loaded', render);
  appState.on('catalog-loaded', render);
  render();
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(): void {
  const root = document.getElementById('estimate-workspace');
  if (!root) return;

  const { catalog, project } = appState;

  if (catalog.phases.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <p>No catalog loaded.</p>
        <p>Use <strong>Catalog → Import</strong> to load your estimating data.</p>
      </div>`;
    return;
  }

  // Build phase-indexed task list from the project's tasks (overrides catalog)
  const tasks = project.tasks.length > 0 ? project.tasks : catalog.tasks;
  const phases = project.phases.length > 0 ? project.phases : catalog.phases;

  const sections = phases
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(phase => {
      const phaseTasks = tasks.filter(t => t.phaseId === phase.id);
      return renderPhase(phase.name, phase.id, phaseTasks);
    });

  root.innerHTML = sections.join('');
  attachInputListeners(root);
}

function renderPhase(phaseName: string, phaseId: string, tasks: Task[]): string {
  if (tasks.length === 0) return '';
  const taskRows = tasks.map(t => renderTask(t)).join('');
  return `
    <section class="phase-section" data-phase="${phaseId}">
      <h2 class="phase-heading">${esc(phaseName)}</h2>
      <div class="task-list">${taskRows}</div>
    </section>`;
}

function renderTask(task: Task): string {
  const scopeValues = getScopeValues(task.id);

  const inputs = task.scopeInputs.map(si => {
    const val = scopeValues.find(s => s.role === si.role)?.value ?? 0;
    return `
      <label class="scope-row">
        <span class="scope-label">${esc(si.label)}</span>
        <input
          class="scope-input"
          type="number"
          step="any"
          value="${val}"
          data-task="${esc(task.id)}"
          data-role="${esc(si.role)}"
          min="0"
        />
      </label>`;
  }).join('');

  const totals = computeTaskTotals(task, scopeValues);
  const materialRows = totals.materialLines.map(ml => `
    <tr>
      <td>${esc(ml.name)}</td>
      <td class="qty-cell">${fmt(ml.qty)}</td>
      <td class="unit-cell">${esc(ml.unit)}</td>
      <td class="cost-cell">${fmtCurrency(ml.cost)}</td>
    </tr>`).join('');

  return `
    <div class="task-card" data-task="${esc(task.id)}">
      <div class="task-header">
        <span class="task-name">${esc(task.name)}</span>
        <span class="task-total">${fmtCurrency(totals.totalCost)}</span>
      </div>
      <div class="task-body">
        <div class="scope-inputs">${inputs}</div>
        ${materialRows || totals.laborCost > 0 ? `
        <table class="material-table">
          <thead><tr><th>Material</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead>
          <tbody>
            ${materialRows}
            <tr class="labor-row">
              <td>Labor</td>
              <td class="qty-cell">${fmt(totals.laborQty)}</td>
              <td class="unit-cell">${esc(task.laborUnit)}</td>
              <td class="cost-cell">${fmtCurrency(totals.laborCost)}</td>
            </tr>
          </tbody>
        </table>` : ''}
      </div>
    </div>`;
}

// ── Event listeners ───────────────────────────────────────────────────────────

function attachInputListeners(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement>('.scope-input').forEach(input => {
    input.addEventListener('change', () => {
      const taskId = input.dataset.task!;
      const role = input.dataset.role!;
      const value = parseFloat(input.value) || 0;
      updateScope(taskId, role, value);
    });
  });
}

function updateScope(taskId: string, role: string, value: number): void {
  const scope = appState.project.scope;
  const idx = scope.findIndex(s => s.taskId === taskId && s.role === role);
  if (idx >= 0) {
    scope[idx].value = value;
  } else {
    scope.push({ taskId, role, value });
  }
  appState.dirty = true;
  appState.emit('scope-changed');

  // Re-render just the totals row for the task
  const card = document.querySelector<HTMLElement>(`.task-card[data-task="${CSS.escape(taskId)}"]`);
  if (card) {
    const task = (appState.project.tasks.concat(appState.catalog.tasks)).find(t => t.id === taskId);
    if (task) {
      const scopeValues = getScopeValues(taskId);
      const totals = computeTaskTotals(task, scopeValues);
      const totalEl = card.querySelector<HTMLElement>('.task-total');
      if (totalEl) totalEl.textContent = fmtCurrency(totals.totalCost);
      // Full re-render for accurate table rows
      const wrapper = card.closest('.task-list');
      if (wrapper) render();
    }
  }
}

// ── Computations ──────────────────────────────────────────────────────────────

interface MaterialLine {
  name: string;
  unit: string;
  qty: number;
  cost: number;
}

interface TaskTotals {
  laborQty: number;
  laborCost: number;
  materialLines: MaterialLine[];
  totalCost: number;
}

function getScopeValues(taskId: string): ScopeEntry[] {
  return appState.project.scope.filter(s => s.taskId === taskId);
}

function computeTaskTotals(task: Task, scopeValues: ScopeEntry[]): TaskTotals {
  const vars = buildVars(scopeValues);

  const laborQty = evalFormula(task.laborQtyFormula, vars);
  const laborRate = task.lockedLaborRate ?? task.laborRate;
  const laborCost = isNaN(laborQty) ? 0 : laborQty * laborRate;

  const materialLines: MaterialLine[] = task.recipe.map((line: RecipeLine) => {
    const mat = findMaterial(line.materialId);
    const qty = evalFormula(line.orderQtyFormula, { ...vars, factor: line.factor });
    const safeQty = isNaN(qty) ? 0 : qty;
    return {
      name: mat?.name ?? line.materialId,
      unit: mat?.unit ?? '',
      qty: safeQty,
      cost: safeQty * (mat?.unitCost ?? 0),
    };
  });

  const matCost = materialLines.reduce((s, l) => s + l.cost, 0);
  return { laborQty: isNaN(laborQty) ? 0 : laborQty, laborCost, materialLines, totalCost: laborCost + matCost };
}

function findMaterial(id: string) {
  return (
    appState.project.snapshot.materials.find(m => m.id === id) ??
    appState.catalog.materials.find(m => m.id === id)
  );
}

// ── Formatting ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  if (isNaN(n)) return '—';
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtCurrency(n: number): string {
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
