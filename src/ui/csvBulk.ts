/**
 * CSV bulk import / export for catalog prices.
 *
 * Export: downloads a CSV with all materials (id, name, unit, unitCost, vendor).
 * Import: parses a CSV of the same shape and updates unitCost values in-place.
 *
 * The CSV is intentionally simple so it can be opened and edited in Excel.
 * Only `unitCost` is updated on import — structural changes (name, unit) are
 * ignored to prevent accidental catalog corruption.
 */

import type { Material } from '../estimate/catalog.ts';
import { appState } from '../appState.ts';
import { saveCatalog } from '../storage/catalogStore.ts';
import { markSnapshotStale } from '../estimate/snapshot.ts';

// ── Export ────────────────────────────────────────────────────────────────────

export function exportCatalogCSV(): void {
  const mats = appState.catalog.materials;
  const header = 'id,name,unit,unitCost,vendor';
  const rows = mats.map((m: Material) =>
    [csvCell(m.id), csvCell(m.name), csvCell(m.unit), m.unitCost.toFixed(4), csvCell(m.vendor)].join(',')
  );
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'catalog-prices.csv';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import ────────────────────────────────────────────────────────────────────

/**
 * Opens a file picker for a CSV and updates material unit costs in the catalog.
 * Returns an object describing how many rows were updated.
 */
export async function importCatalogCSV(): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const file = await pickCsvFile();
  if (!file) return { updated: 0, skipped: 0, errors: [] };

  const text = await file.text();
  return applyCSV(text);
}

function applyCSV(csv: string): { updated: number; skipped: number; errors: string[] } {
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return { updated: 0, skipped: 0, errors: ['Empty file'] };

  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
  const idCol   = headers.indexOf('id');
  const costCol = headers.indexOf('unitcost');

  if (idCol < 0 || costCol < 0) {
    return { updated: 0, skipped: 0, errors: ['CSV must have "id" and "unitCost" columns'] };
  }

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCSVRow(line);
    const id   = cols[idCol]?.trim() ?? '';
    const cost = parseFloat(cols[costCol]?.trim() ?? '');

    if (!id) { skipped++; continue; }
    if (isNaN(cost)) { errors.push(`Row ${i + 1}: invalid cost for id "${id}"`); skipped++; continue; }

    const mat = appState.catalog.materials.find((m: Material) => m.id === id);
    if (!mat) { skipped++; continue; }

    mat.unitCost = cost;
    updated++;
  }

  return { updated, skipped, errors };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickCsvFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Minimal RFC-4180 CSV row parser (handles quoted fields with embedded commas).
 */
function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let s = '';
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { s += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else s += line[i++];
      }
      cells.push(s);
      if (line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end < 0) { cells.push(line.slice(i)); break; }
      cells.push(line.slice(i, end));
      i = end + 1;
    }
  }
  return cells;
}

function csvCell(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// ── Public workflow (used by catalog manager button) ─────────────────────────

export async function handleImportCSV(): Promise<void> {
  const result = await importCatalogCSV();
  if (result.updated === 0 && result.errors.length === 0) return;

  const msg = [
    `Updated: ${result.updated} material prices`,
    result.skipped > 0 ? `Skipped: ${result.skipped} rows` : '',
    result.errors.length > 0 ? `Errors:\n${result.errors.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  alert(msg);

  if (result.updated > 0) {
    await saveCatalog(appState.catalog);
    appState.project = markSnapshotStale(appState.project);
    appState.emit('catalog-changed');
  }
}
