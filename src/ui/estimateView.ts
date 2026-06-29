/**
 * Estimate workspace — the main editing view.
 *
 * Layout:
 *   • Left sidebar: phase navigation + grand total
 *   • Right panel: active phase → task cards with scope inputs and live totals
 *
 * Features:
 *   • Phases & tasks come from the project (seeded from catalog).
 *   • Scope inputs (Length, Width, Height, …) accept numeric entry.
 *   • Material quantities and costs recompute live via the formula engine.
 *   • Grand total aggregates all phases.
 *   • Phase & task names are editable inline.
 *   • "Add Phase" / "Add Task" buttons scaffold new entries.
 */

import { appState } from '../appState.ts';
import { evalFormula, buildVars } from '../estimate/formulaEngine.ts';
import type { RecipeLine, ScopeInputDef, Phase } from '../estimate/catalog.ts';
import type { ScopeEntry, SnapshotTask } from '../estimate/project.ts';
import { getMaterialCost } from '../estimate/snapshot.ts';
import { saveCatalog } from '../storage/catalogStore.ts';
import { showPrompt, showConfirm } from './modal.ts';
import { getTaskColor } from '../estimate/taskColors.ts';
import { getAssignmentsForTask } from '../estimate/measureAssign.ts';

export function initEstimateUI(): void {
  appState.on('project-new', renderAll);
  appState.on('project-loaded', renderAll);
  appState.on('catalog-loaded', renderAll);
  appState.on('project-changed', renderAll);
  // When a canvas measurement is applied, refresh affected scope inputs without
  // tearing down the whole DOM (avoids focus loss / scroll jump)
  appState.on('scope-changed', refreshAllScopeInputs);

  // Wire "Add Phase" once — button lives in static HTML, not re-rendered
  document.getElementById('btn-add-phase')?.addEventListener('click', () => {
    showPrompt('New Phase', '', 'Phase name')
      .then(name => {
        if (!name) return;
        const id = `phase-${Date.now()}`;
        appState.project.phases.push({ id, name, order: getPhases().length });
        appState.dirty = true;
        setActivePhaseId(id);
        appState.emit('project-changed');
      })
      .catch(console.error);
  });

  renderAll();
}

// activePhaseId lives in appState so the canvas panel can react to it.
// This local alias is kept for readability inside this module.
function getActivePhaseId(): string | null { return appState.activePhaseId; }
function setActivePhaseId(id: string | null): void {
  appState.activePhaseId = id;
  appState.emit('phase-changed');
}

// ── Top-level render ──────────────────────────────────────────────────────────

function renderAll(): void {
  renderSidebar();
  renderWorkspace();
  renderGrandTotal();
  updateTitle();
}

function updateTitle(): void {
  document.title = `${appState.project.name} — Project Estimator`;
  const nameEl = document.getElementById('project-name-display');
  if (nameEl) nameEl.textContent = appState.project.name;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function renderSidebar(): void {
  const nav = document.getElementById('phase-nav');
  if (!nav) return;

  const phases = getPhases();

  if (!getActivePhaseId() && phases.length > 0) setActivePhaseId(phases[0].id);

  nav.innerHTML = phases.map(ph => `
    <a href="#" class="phase-link ${ph.id === getActivePhaseId() ? 'active' : ''}" data-phase="${esc(ph.id)}">
      ${esc(ph.name)}
    </a>`).join('');

  nav.querySelectorAll<HTMLElement>('.phase-link').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      setActivePhaseId(a.dataset.phase!);
      renderAll();
    });
  });
}

// ── Workspace ─────────────────────────────────────────────────────────────────

function renderWorkspace(): void {
  const root = document.getElementById('estimate-workspace');
  if (!root) return;

  const phases = getPhases();
  if (phases.length === 0) {
    root.innerHTML = emptyState();
    return;
  }

  const phase = phases.find(p => p.id === getActivePhaseId()) ?? phases[0];
  if (!phase) { root.innerHTML = emptyState(); return; }

  const tasks = getTasks(phase.id);

  root.innerHTML = `
    <div class="phase-header-row">
      <span class="phase-title-editable" data-phase="${esc(phase.id)}">${esc(phase.name)}</span>
      <div class="phase-actions">
        <button class="icon-btn danger" data-delete-phase="${esc(phase.id)}" title="Delete phase">✕</button>
      </div>
    </div>
    <div class="task-list" id="task-list-${esc(phase.id)}">
      ${tasks.map(t => renderTask(t)).join('')}
    </div>
    <button class="add-task-btn" data-phase="${esc(phase.id)}">+ Add Task</button>`;

  attachWorkspaceListeners(root, phase);
}

function renderTask(task: SnapshotTask): string {
  const scopeValues = getScopeValues(task.id);
  const totals = computeTaskTotals(task, scopeValues);
  const inputs = (task.scopeInputs ?? []).map((si: ScopeInputDef) => {
    const val = scopeValues.find(s => s.role === si.role)?.value ?? 0;
    return `
      <label class="scope-row">
        <span class="scope-label">${esc(si.label)}</span>
        <input class="scope-input" type="number" step="any" min="0"
          value="${val}"
          data-task="${esc(task.id)}"
          data-role="${esc(si.role)}"
        />
      </label>`;
  }).join('');

  const matRows = totals.materialLines.map(ml => `
    <tr>
      <td>${esc(ml.name)}</td>
      <td class="qty-cell">${fmt(ml.qty)}</td>
      <td class="unit-cell">${esc(ml.unit)}</td>
      <td class="cost-cell">${fmtCurrency(ml.cost)}</td>
    </tr>`).join('');

  const taskColor = getTaskColor(task.id);
  const assignments = getAssignmentsForTask(task.id);
  const assignBadge = assignments.length > 0
    ? `<span class="task-assign-badge" title="${assignments.length} measurement(s) assigned">${assignments.length} 📐</span>`
    : '';

  return `
    <div class="task-card" data-task="${esc(task.id)}" style="--task-color:${taskColor}">
      <div class="task-header">
        <span class="task-color-swatch" style="background:${taskColor}" title="Task color on canvas"></span>
        <span class="task-name-editable" data-task="${esc(task.id)}">${esc(task.name)}</span>
        <div class="task-header-right">
          ${assignBadge}
          <span class="task-total" data-task-total="${esc(task.id)}">${fmtCurrency(totals.totalCost)}</span>
          <button class="icon-btn danger" data-delete-task="${esc(task.id)}" title="Delete task">✕</button>
        </div>
      </div>
      <div class="task-body">
        <div class="scope-inputs">${inputs}</div>
        ${(matRows || totals.laborCost > 0) ? `
        <table class="material-table">
          <thead><tr>
            <th>Material / Labor</th><th>Qty</th><th>Unit</th><th>Cost</th>
          </tr></thead>
          <tbody>
            ${matRows}
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

// ── Grand Total ───────────────────────────────────────────────────────────────

function renderGrandTotal(): void {
  const el = document.getElementById('grand-total');
  if (!el) return;
  const total = computeGrandTotal();
  el.textContent = fmtCurrency(total);
}

function computeGrandTotal(): number {
  return getTasks().reduce((sum, task) => {
    const scopeValues = getScopeValues(task.id);
    return sum + computeTaskTotals(task, scopeValues).totalCost;
  }, 0);
}

// ── Event listeners ────────────────────────────────────────────────────────────

function attachWorkspaceListeners(root: HTMLElement, phase: Phase): void {

  // Scope input changes
  root.querySelectorAll<HTMLInputElement>('.scope-input').forEach(input => {
    input.addEventListener('input', () => {
      const taskId = input.dataset.task!;
      const role = input.dataset.role!;
      const value = parseFloat(input.value) || 0;
      updateScope(taskId, role, value);
    });
  });

  // Inline phase name editing
  root.querySelectorAll<HTMLElement>('.phase-title-editable').forEach(el => {
    el.addEventListener('dblclick', () => {
      const phaseId = el.dataset.phase!;
      const current = el.textContent?.trim() ?? '';
      void showPrompt('Rename Phase', current).then(name => {
        if (!name || name === current) return;
        const ph = appState.project.phases.find(p => p.id === phaseId);
        if (ph) { ph.name = name; appState.dirty = true; appState.emit('project-changed'); }
      });
    });
  });

  // Inline task name editing
  root.querySelectorAll<HTMLElement>('.task-name-editable').forEach(el => {
    el.addEventListener('dblclick', () => {
      const taskId = el.dataset.task!;
      const current = el.textContent?.trim() ?? '';
      void showPrompt('Rename Task', current).then(name => {
        if (!name || name === current) return;
        const t = appState.project.tasks.find(tk => tk.id === taskId);
        if (t) { t.name = name; appState.dirty = true; appState.emit('project-changed'); }
      });
    });
  });

  // Delete phase
  root.querySelectorAll<HTMLElement>('[data-delete-phase]').forEach(btn => {
    btn.addEventListener('click', () => {
      const phaseId = btn.dataset.deletePhase!;
      const ph = appState.project.phases.find(p => p.id === phaseId);
      void showConfirm(`Delete phase "${ph?.name ?? phaseId}" and all its tasks?`).then(ok => {
        if (!ok) return;
        appState.project.phases = appState.project.phases.filter(p => p.id !== phaseId);
        appState.project.tasks  = appState.project.tasks.filter(t => t.phaseId !== phaseId);
        appState.dirty = true;
        setActivePhaseId(appState.project.phases[0]?.id ?? null);
        appState.emit('project-changed');
      });
    });
  });

  // Delete task
  root.querySelectorAll<HTMLElement>('[data-delete-task]').forEach(btn => {
    btn.addEventListener('click', () => {
      const taskId = btn.dataset.deleteTask!;
      const t = appState.project.tasks.find(tk => tk.id === taskId);
      void showConfirm(`Delete task "${t?.name ?? taskId}"?`).then(ok => {
        if (!ok) return;
        appState.project.tasks = appState.project.tasks.filter(tk => tk.id !== taskId);
        appState.project.scope = appState.project.scope.filter(s => s.taskId !== taskId);
        appState.dirty = true;
        appState.emit('project-changed');
      });
    });
  });

  // Add task
  root.querySelectorAll<HTMLElement>('[data-phase].add-task-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      void showPrompt('New Task', '', 'Task name').then(name => {
        if (!name) return;
        const id = `task-${Date.now()}`;
        const newTask: SnapshotTask = {
          id,
          phaseId: phase.id,
          name,
          laborUnit: 'LF',
          laborRate: 0,
          laborQtyFormula: 'Length',
          scopeInputs: [{ role: 'length', label: 'Length (ft)', unit: 'ft', required: true }],
          recipe: [],
        };
        appState.project.tasks.push(newTask);
        appState.dirty = true;
        appState.emit('project-changed');
      });
    });
  });
}

function updateScope(taskId: string, role: string, value: number): void {
  const scope = appState.project.scope;
  const idx = scope.findIndex((s: ScopeEntry) => s.taskId === taskId && s.role === role);
  if (idx >= 0) scope[idx].value = value;
  else scope.push({ taskId, role, value });
  appState.dirty = true;

  // Live-update totals without full re-render
  const task = appState.project.tasks.find(t => t.id === taskId);
  if (task) {
    const scopeValues = getScopeValues(taskId);
    const totals = computeTaskTotals(task, scopeValues);
    const el = document.querySelector<HTMLElement>(`[data-task-total="${CSS.escape(taskId)}"]`);
    if (el) el.textContent = fmtCurrency(totals.totalCost);
  }
  renderGrandTotal();
}

/**
 * Called when a canvas measurement is applied to a scope entry.
 * Walks all rendered scope inputs and syncs their displayed values from the
 * current project state, then updates task totals and the grand total.
 * Does NOT re-render the full DOM so focus and scroll position are preserved.
 */
function refreshAllScopeInputs(): void {
  const scope = appState.project.scope;

  // Update every visible scope input field
  document.querySelectorAll<HTMLInputElement>('.scope-input').forEach(input => {
    const taskId = input.dataset.task;
    const role = input.dataset.role;
    if (!taskId || !role) return;
    const entry = scope.find((s: ScopeEntry) => s.taskId === taskId && s.role === role);
    if (entry !== undefined) {
      // Only update if the value actually changed to avoid disturbing the cursor
      const newVal = String(entry.value);
      if (input.value !== newVal) input.value = newVal;
    }
  });

  // Update each task's cost total
  appState.project.tasks.forEach(task => {
    const scopeValues = getScopeValues(task.id);
    const totals = computeTaskTotals(task, scopeValues);
    const el = document.querySelector<HTMLElement>(`[data-task-total="${CSS.escape(task.id)}"]`);
    if (el) el.textContent = fmtCurrency(totals.totalCost);
  });

  renderGrandTotal();
}

// ── Computations ──────────────────────────────────────────────────────────────

interface MaterialLine { name: string; unit: string; qty: number; cost: number; }
interface TaskTotals { laborQty: number; laborCost: number; materialLines: MaterialLine[]; totalCost: number; }

function getScopeValues(taskId: string): ScopeEntry[] {
  return appState.project.scope.filter((s: ScopeEntry) => s.taskId === taskId);
}

function computeTaskTotals(task: SnapshotTask, scopeValues: ScopeEntry[]): TaskTotals {
  const vars = buildVars(scopeValues);
  const laborQty = evalFormula(task.laborQtyFormula, vars);
  const laborRate = task.lockedLaborRate ?? task.laborRate;
  const laborCost = isNaN(laborQty) ? 0 : laborQty * laborRate;

  const materialLines: MaterialLine[] = (task.recipe ?? []).map((line: RecipeLine) => {
    const qty = evalFormula(line.orderQtyFormula, { ...vars, factor: line.factor });
    const safeQty = isNaN(qty) ? 0 : qty;
    const cost = safeQty * getMaterialCost(line.materialId, appState.project, appState.catalog);
    const mat =
      appState.project.snapshot.materials.find(m => m.id === line.materialId) ??
      appState.catalog.materials.find(m => m.id === line.materialId);
    return { name: mat?.name ?? line.materialId, unit: mat?.unit ?? '', qty: safeQty, cost };
  });

  const matCost = materialLines.reduce((s, l) => s + l.cost, 0);
  return { laborQty: isNaN(laborQty) ? 0 : laborQty, laborCost, materialLines, totalCost: laborCost + matCost };
}

// ── Data accessors ────────────────────────────────────────────────────────────

function getPhases(): Phase[] {
  return [...appState.project.phases].sort((a, b) => a.order - b.order);
}

function getTasks(phaseId?: string): SnapshotTask[] {
  const all = appState.project.tasks;
  return phaseId ? all.filter((t: SnapshotTask) => t.phaseId === phaseId) : all;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function emptyState(): string {
  return `<div class="empty-state">
    <p>No phases yet. Use <strong>+ Add Phase</strong> in the sidebar to start,</p>
    <p>or run <code>npm run import:catalog</code> to load your estimating data.</p>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  if (isNaN(n)) return '—';
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtCurrency(n: number): string {
  if (isNaN(n) || n === 0) return '$0.00';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Satisfy TS — saveCatalog imported for future catalog manager use
void saveCatalog;
