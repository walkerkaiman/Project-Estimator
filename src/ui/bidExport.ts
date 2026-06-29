/**
 * Bid Export — generates a raw material + labor summary.
 *
 * Outputs:
 *   • In-app "Bid Summary" modal (rendered as HTML table).
 *   • CSV download (compatible with Excel).
 *
 * The bid groups all tasks' costs by phase, then provides a grand total.
 * All prices come from the project's price snapshot, not live catalog data.
 */

import { appState } from '../appState.ts';
import { evalFormula, buildVars } from '../estimate/formulaEngine.ts';
import { getMaterialCost } from '../estimate/snapshot.ts';
import type { SnapshotTask } from '../estimate/project.ts';
import type { ScopeEntry } from '../estimate/project.ts';
import type { RecipeLine } from '../estimate/catalog.ts';

// ── Public API ────────────────────────────────────────────────────────────────

export function openBidExport(): void {
  const existing = document.getElementById('bid-modal');
  if (existing) existing.remove();

  const summary = computeSummary();
  const modal = document.createElement('div');
  modal.id = 'bid-modal';
  modal.className = 'modal-backdrop';
  modal.innerHTML = buildModalHTML(summary);
  document.body.appendChild(modal);

  modal.querySelector('#bid-modal-close')?.addEventListener('click', () => modal.remove());
  modal.querySelector('#bid-download-csv')?.addEventListener('click', () => downloadCSV(summary));
}

// ── Data model ────────────────────────────────────────────────────────────────

interface MatLine { name: string; unit: string; qty: number; unitCost: number; totalCost: number; }
interface LaborLine { task: string; qty: number; unit: string; rate: number; totalCost: number; }
interface PhaseSection { phaseName: string; materials: MatLine[]; labor: LaborLine[]; subtotal: number; }
interface BidSummary { snapshotDate: string; phases: PhaseSection[]; grandTotal: number; projectName: string; }

// ── Computation ───────────────────────────────────────────────────────────────

function computeSummary(): BidSummary {
  const { project, catalog } = appState;
  const phases = project.phases.slice().sort((a, b) => a.order - b.order);

  const sections: PhaseSection[] = phases.map(phase => {
    const tasks = project.tasks.filter((t: SnapshotTask) => t.phaseId === phase.id);

    const matAgg = new Map<string, MatLine>();
    const laborLines: LaborLine[] = [];

    for (const task of tasks) {
      const scopeValues = project.scope.filter((s: ScopeEntry) => s.taskId === task.id);
      const vars = buildVars(scopeValues);

      // Materials
      for (const line of (task.recipe ?? []) as RecipeLine[]) {
        const qty = evalFormula(line.orderQtyFormula, { ...vars, factor: line.factor });
        if (isNaN(qty) || qty <= 0) continue;
        const unitCost = getMaterialCost(line.materialId, project, catalog);
        const mat =
          project.snapshot.materials.find(m => m.id === line.materialId) ??
          catalog.materials.find(m => m.id === line.materialId);
        const key = line.materialId;
        if (matAgg.has(key)) {
          const entry = matAgg.get(key)!;
          entry.qty += qty;
          entry.totalCost += qty * unitCost;
        } else {
          matAgg.set(key, {
            name: mat?.name ?? line.materialId,
            unit: mat?.unit ?? '',
            qty,
            unitCost,
            totalCost: qty * unitCost,
          });
        }
      }

      // Labor
      const laborQty = evalFormula(task.laborQtyFormula, vars);
      const laborRate = task.lockedLaborRate ?? task.laborRate;
      if (!isNaN(laborQty) && laborQty > 0 && laborRate > 0) {
        laborLines.push({
          task: task.name,
          qty: laborQty,
          unit: task.laborUnit,
          rate: laborRate,
          totalCost: laborQty * laborRate,
        });
      }
    }

    const materials = [...matAgg.values()];
    const matTotal = materials.reduce((s, l) => s + l.totalCost, 0);
    const laborTotal = laborLines.reduce((s, l) => s + l.totalCost, 0);

    return {
      phaseName: phase.name,
      materials,
      labor: laborLines,
      subtotal: matTotal + laborTotal,
    };
  });

  return {
    projectName: project.name,
    snapshotDate: project.snapshot.takenAt,
    phases: sections,
    grandTotal: sections.reduce((s, ph) => s + ph.subtotal, 0),
  };
}

// ── HTML modal ────────────────────────────────────────────────────────────────

function buildModalHTML(s: BidSummary): string {
  const phaseHTML = s.phases.map(ph => {
    if (ph.materials.length === 0 && ph.labor.length === 0) return '';
    const matRows = ph.materials.map(m => `
      <tr>
        <td>${esc(m.name)}</td>
        <td class="qty-cell">${fmt(m.qty)}</td>
        <td class="unit-cell">${esc(m.unit)}</td>
        <td class="cost-cell">${fmtCurrency(m.unitCost)}</td>
        <td class="cost-cell">${fmtCurrency(m.totalCost)}</td>
      </tr>`).join('');

    const laborRows = ph.labor.map(l => `
      <tr class="labor-row">
        <td>Labor — ${esc(l.task)}</td>
        <td class="qty-cell">${fmt(l.qty)}</td>
        <td class="unit-cell">${esc(l.unit)}</td>
        <td class="cost-cell">${fmtCurrency(l.rate)}</td>
        <td class="cost-cell">${fmtCurrency(l.totalCost)}</td>
      </tr>`).join('');

    return `
      <section class="bid-phase-section">
        <h3 class="bid-phase-heading">${esc(ph.phaseName)}</h3>
        <table class="material-table bid-table">
          <thead><tr>
            <th>Item</th><th>Qty</th><th>Unit</th><th>Unit Cost</th><th>Total</th>
          </tr></thead>
          <tbody>${matRows}${laborRows}</tbody>
          <tfoot><tr class="bid-subtotal-row">
            <td colspan="4">Phase Subtotal</td>
            <td class="cost-cell">${fmtCurrency(ph.subtotal)}</td>
          </tr></tfoot>
        </table>
      </section>`;
  }).join('');

  return `
    <div class="modal-box bid-modal-box">
      <div class="modal-header">
        <h2>Bid Summary — ${esc(s.projectName)}</h2>
        <button class="modal-close" id="bid-modal-close">✕</button>
      </div>
      <div class="bid-meta">Prices as of ${new Date(s.snapshotDate).toLocaleDateString()}</div>
      <div class="modal-body bid-body">${phaseHTML || '<p class="cat-hint">No scope data entered yet.</p>'}</div>
      <div class="modal-footer bid-footer">
        <div class="bid-grand-total">Grand Total: <strong>${fmtCurrency(s.grandTotal)}</strong></div>
        <div class="bid-actions">
          <button class="btn-secondary" id="bid-modal-close">Close</button>
          <button class="btn-primary" id="bid-download-csv">Download CSV</button>
        </div>
      </div>
    </div>`;
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function downloadCSV(s: BidSummary): void {
  const lines: string[] = [
    `Project Estimator — Bid Summary`,
    `Project,${csvCell(s.projectName)}`,
    `Prices as of,${new Date(s.snapshotDate).toLocaleDateString()}`,
    ``,
    `Phase,Item,Qty,Unit,Unit Cost,Total`,
  ];

  for (const ph of s.phases) {
    for (const m of ph.materials) {
      lines.push([csvCell(ph.phaseName), csvCell(m.name), m.qty, csvCell(m.unit), m.unitCost.toFixed(2), m.totalCost.toFixed(2)].join(','));
    }
    for (const l of ph.labor) {
      lines.push([csvCell(ph.phaseName), csvCell(`Labor — ${l.task}`), l.qty, csvCell(l.unit), l.rate.toFixed(2), l.totalCost.toFixed(2)].join(','));
    }
    lines.push([csvCell(ph.phaseName), 'Phase Subtotal', '', '', '', ph.subtotal.toFixed(2)].join(','));
    lines.push('');
  }

  lines.push(['', 'GRAND TOTAL', '', '', '', s.grandTotal.toFixed(2)].join(','));

  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${s.projectName.replace(/[^a-z0-9]/gi, '_')}_bid.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Formatting ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function fmt(n: number): string {
  if (isNaN(n)) return '—';
  return n % 1 === 0 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtCurrency(n: number): string {
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
