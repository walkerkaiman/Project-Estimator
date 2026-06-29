/**
 * Catalog Manager — modal dialog for editing the master catalog.
 *
 * Tabs: Materials | Labor Rates | Phases & Tasks
 *
 * Changes here update `appState.catalog` and persist via `saveCatalog()`.
 * Projects that are already open are flagged `snapshotStale = true`.
 */

import { appState } from '../appState.ts';
import { saveCatalog } from '../storage/catalogStore.ts';
import { markSnapshotStale } from '../estimate/snapshot.ts';
import type { Material, Task } from '../estimate/catalog.ts';
import { exportCatalogCSV, handleImportCSV } from './csvBulk.ts';

// ── Public API ────────────────────────────────────────────────────────────────

export function openCatalogManager(): void {
  const existing = document.getElementById('catalog-modal');
  if (existing) { existing.remove(); }

  const modal = document.createElement('div');
  modal.id = 'catalog-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = buildModalHTML();
  document.body.appendChild(modal);

  attachListeners(modal);
  showTab(modal, 'materials');
}

// ── HTML ──────────────────────────────────────────────────────────────────────

function buildModalHTML(): string {
  return `
    <div class="modal-box catalog-modal-box">
      <div class="modal-header">
        <h2>Catalog Manager</h2>
        <button class="modal-close" id="catalog-modal-close">✕</button>
      </div>
      <div class="modal-tabs">
        <button class="tab-btn active" data-tab="materials">Materials</button>
        <button class="tab-btn" data-tab="labor">Labor Rates</button>
        <button class="tab-btn" data-tab="phases">Phases &amp; Tasks</button>
      </div>
      <div class="modal-body" id="catalog-modal-body">
        <!-- content rendered per tab -->
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="catalog-export-csv">Export CSV</button>
        <button class="btn-secondary" id="catalog-import-csv">Import CSV</button>
        <button class="btn-secondary" id="catalog-modal-close-footer">Close</button>
        <button class="btn-primary" id="catalog-save-btn">Save Catalog</button>
      </div>
    </div>`;
}

// ── Tab rendering ─────────────────────────────────────────────────────────────

type Tab = 'materials' | 'labor' | 'phases';

function showTab(modal: HTMLElement, tab: Tab): void {
  modal.querySelectorAll<HTMLElement>('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const body = modal.querySelector<HTMLElement>('#catalog-modal-body');
  if (!body) return;

  switch (tab) {
    case 'materials': body.innerHTML = renderMaterialsTab(); break;
    case 'labor':     body.innerHTML = renderLaborTab(); break;
    case 'phases':    body.innerHTML = renderPhasesTab(); break;
  }

  attachTabListeners(body, tab, modal);
}

function renderMaterialsTab(): string {
  const mats = appState.catalog.materials;
  const rows = mats.map((m, i) => `
    <tr>
      <td><input class="cat-input" type="text" value="${esc(m.name)}" data-mat="${i}" data-field="name"/></td>
      <td><input class="cat-input narrow" type="text" value="${esc(m.unit)}" data-mat="${i}" data-field="unit"/></td>
      <td><input class="cat-input narrow" type="number" step="0.01" min="0" value="${m.unitCost}" data-mat="${i}" data-field="unitCost"/></td>
      <td><input class="cat-input" type="text" value="${esc(m.vendor)}" data-mat="${i}" data-field="vendor"/></td>
      <td><button class="icon-btn danger" data-delete-mat="${i}">✕</button></td>
    </tr>`).join('');

  return `
    <table class="cat-table">
      <thead><tr><th>Name</th><th>Unit</th><th>Unit Cost ($)</th><th>Vendor</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="color:var(--color-text-muted);text-align:center;padding:16px">No materials. Add one below.</td></tr>'}</tbody>
    </table>
    <button class="add-row-btn" id="add-mat-btn">+ Add Material</button>`;
}

function renderLaborTab(): string {
  const tasks = appState.catalog.tasks;
  const phases = appState.catalog.phases;
  const phaseMap = new Map(phases.map(p => [p.id, p.name]));

  const rows = tasks.map((t, i) => `
    <tr>
      <td>${esc(phaseMap.get(t.phaseId) ?? t.phaseId)}</td>
      <td>${esc(t.name)}</td>
      <td><input class="cat-input narrow" type="number" step="0.01" min="0" value="${t.laborRate}" data-task="${i}" data-field="laborRate"/></td>
      <td><input class="cat-input narrow" type="text" value="${esc(t.laborUnit)}" data-task="${i}" data-field="laborUnit"/></td>
    </tr>`).join('');

  return `
    <p class="cat-hint">Edit labor rates for each task. Changes here will be used for new projects and on "Refresh Prices".</p>
    <table class="cat-table">
      <thead><tr><th>Phase</th><th>Task</th><th>Rate ($/unit)</th><th>Unit</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:var(--color-text-muted);text-align:center;padding:16px">No tasks in catalog.</td></tr>'}</tbody>
    </table>`;
}

function renderPhasesTab(): string {
  const phases = appState.catalog.phases.slice().sort((a, b) => a.order - b.order);
  const tasks  = appState.catalog.tasks;

  const sections = phases.map((ph, pi) => {
    const phaseTasks = tasks.filter(t => t.phaseId === ph.id);
    const taskRows = phaseTasks.map((t, _ti) => `
      <div class="phase-task-row">
        <span>${esc(t.name)}</span>
        <button class="icon-btn danger" data-delete-cat-task="${tasks.indexOf(t)}" title="Delete task">✕</button>
      </div>`).join('') || '<div class="cat-hint" style="margin-left:16px">No tasks.</div>';

    return `
      <div class="phase-section-cat" data-phase-idx="${pi}">
        <div class="phase-cat-header">
          <input class="cat-input" type="text" value="${esc(ph.name)}" data-phase="${pi}" data-field="name"/>
          <button class="icon-btn danger" data-delete-cat-phase="${pi}" title="Delete phase">✕</button>
        </div>
        <div class="phase-tasks">${taskRows}</div>
      </div>`;
  }).join('');

  return `
    <div class="phases-list">${sections || '<p class="cat-hint">No phases in catalog.</p>'}</div>
    <button class="add-row-btn" id="add-phase-cat-btn">+ Add Phase</button>`;
}

// ── Listeners ─────────────────────────────────────────────────────────────────

function attachListeners(modal: HTMLElement): void {
  modal.querySelector('#catalog-modal-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#catalog-modal-close-footer')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#catalog-save-btn')?.addEventListener('click', () => void handleSave(modal));
  modal.querySelector('#catalog-export-csv')?.addEventListener('click', exportCatalogCSV);
  modal.querySelector('#catalog-import-csv')?.addEventListener('click', () => void handleImportCSV());

  modal.querySelectorAll<HTMLElement>('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(modal, btn.dataset.tab as Tab));
  });
}

function attachTabListeners(body: HTMLElement, tab: Tab, modal: HTMLElement): void {
  if (tab === 'materials') {
    body.querySelectorAll<HTMLInputElement>('[data-mat]').forEach(input => {
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.mat!);
        const field = input.dataset.field as keyof Material;
        const mat = appState.catalog.materials[i];
        if (!mat) return;
        if (field === 'unitCost') {
          (mat as unknown as Record<string, unknown>)[field] = parseFloat(input.value) || 0;
        } else {
          (mat as unknown as Record<string, unknown>)[field] = input.value;
        }
      });
    });

    body.querySelectorAll<HTMLElement>('[data-delete-mat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.deleteMat!);
        appState.catalog.materials.splice(i, 1);
        showTab(modal, 'materials');
      });
    });

    body.querySelector('#add-mat-btn')?.addEventListener('click', () => {
      appState.catalog.materials.push({
        id: `mat-${Date.now()}`, name: 'New Material', unit: 'each',
        unitCost: 0, vendor: '', notes: '',
      });
      showTab(modal, 'materials');
    });
  }

  if (tab === 'labor') {
    body.querySelectorAll<HTMLInputElement>('[data-task]').forEach(input => {
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.task!);
        const field = input.dataset.field as keyof Task;
        const task = appState.catalog.tasks[i];
        if (!task) return;
        if (field === 'laborRate') {
          (task as unknown as Record<string, unknown>)[field] = parseFloat(input.value) || 0;
        } else {
          (task as unknown as Record<string, unknown>)[field] = input.value;
        }
      });
    });
  }

  if (tab === 'phases') {
    body.querySelectorAll<HTMLInputElement>('[data-phase]').forEach(input => {
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.phase!);
        const ph = appState.catalog.phases[i];
        if (ph && input.dataset.field === 'name') ph.name = input.value;
      });
    });

    body.querySelectorAll<HTMLElement>('[data-delete-cat-phase]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.deleteCatPhase!);
        const phId = appState.catalog.phases[i]?.id;
        if (!confirm(`Delete phase and all its tasks from the catalog?`)) return;
        appState.catalog.phases.splice(i, 1);
        if (phId) appState.catalog.tasks = appState.catalog.tasks.filter(t => t.phaseId !== phId);
        showTab(modal, 'phases');
      });
    });

    body.querySelectorAll<HTMLElement>('[data-delete-cat-task]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.deleteCatTask!);
        if (!confirm(`Delete this task from the catalog?`)) return;
        appState.catalog.tasks.splice(i, 1);
        showTab(modal, 'phases');
      });
    });

    body.querySelector('#add-phase-cat-btn')?.addEventListener('click', () => {
      const name = prompt('New phase name:');
      if (!name?.trim()) return;
      appState.catalog.phases.push({ id: `phase-${Date.now()}`, name: name.trim(), order: appState.catalog.phases.length });
      showTab(modal, 'phases');
    });
  }
}

async function handleSave(modal: HTMLElement): Promise<void> {
  await saveCatalog(appState.catalog);
  appState.project = markSnapshotStale(appState.project);
  appState.emit('catalog-changed');
  modal.remove();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
