/**
 * PDF canvas panel — the measurement workspace.
 *
 * Manages:
 *   • Loading a PDF (via file picker or drag-drop)
 *   • Rendering pages via pdf.js
 *   • Hosting the Konva stage with measurement tools
 *   • Saving/loading measurement markups within the project
 *   • Emitting applyMeasurement() when a measurement is placed
 */

import { canvasState } from '../canvas-state/canvasState.ts';
import { createKonvaStageManager, type KonvaStageManager } from '../canvas/stage.ts';
import { loadPdf, fitPageScale, type PdfRenderer } from '../pdf/renderer.ts';
import { SelectTool } from '../tools/selectTool.ts';
import { ScaleSetTool } from '../tools/scaleSetTool.ts';
import { MeasureLinearTool } from '../tools/measureLinearTool.ts';
import { MeasureRectTool } from '../tools/measureRectTool.ts';
import { MeasurePolyTool } from '../tools/measurePolyTool.ts';
import { BaseTool, type ToolContext } from '../tools/baseTool.ts';
import type { Markup, PageScale } from '../model/document.ts';
import { DEFAULT_STROKE_STYLE } from '../model/document.ts';
import { generateId } from '../model/document.ts';
import { computeScale } from '../measure/scale.ts';
import { applyMeasurement } from '../estimate/measureAssign.ts';
import { appState } from '../appState.ts';
import { isTauri } from '../tauri/integration.ts';

// ── State ─────────────────────────────────────────────────────────────────────

let stageManager: KonvaStageManager | null = null;
let pdfRenderer: PdfRenderer | null = null;
let activeTool: BaseTool | null = null;
let tools: Map<string, BaseTool> = new Map();
let currentPageIndex = 0;
let pageScale: PageScale = { pointsPerUnit: 0, calibrationUnit: 'ft', calibrated: false };

// Per-page markups (stored in project)
function getPageMarkups(): Markup[] {
  return (appState.project as unknown as { canvasPages?: { markups: Markup[] }[] }).canvasPages?.[currentPageIndex]?.markups ?? [];
}

function ensureCanvasPages(totalPages: number): void {
  const proj = appState.project as unknown as { canvasPages?: { markups: Markup[]; scale?: PageScale }[] };
  if (!proj.canvasPages) proj.canvasPages = [];
  while (proj.canvasPages.length < totalPages) {
    proj.canvasPages.push({ markups: [], scale: undefined });
  }
}

function saveMarkup(markup: Markup): void {
  const proj = appState.project as unknown as { canvasPages?: { markups: Markup[]; scale?: PageScale }[] };
  if (!proj.canvasPages) return;
  proj.canvasPages[currentPageIndex].markups.push(markup);
  appState.dirty = true;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initPdfCanvas(): void {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  stageManager = createKonvaStageManager('canvas-container');

  // Toolbar buttons
  document.getElementById('btn-load-pdf')?.addEventListener('click', () => void handleLoadPdf());
  document.getElementById('btn-tool-select')?.addEventListener('click', () => setTool('select'));
  document.getElementById('btn-tool-scale')?.addEventListener('click', () => setTool('scale-set'));
  document.getElementById('btn-tool-linear')?.addEventListener('click', () => setTool('measure-linear'));
  document.getElementById('btn-tool-rect')?.addEventListener('click', () => setTool('measure-rect'));
  document.getElementById('btn-tool-poly')?.addEventListener('click', () => setTool('measure-poly'));
  document.getElementById('btn-canvas-zoom-in')?.addEventListener('click', () => zoom(1.25));
  document.getElementById('btn-canvas-zoom-out')?.addEventListener('click', () => zoom(0.8));
  document.getElementById('btn-canvas-fit')?.addEventListener('click', fitPage);

  // Build tools
  const ctx = buildToolContext();
  tools.set('select', new SelectTool(ctx));
  tools.set('scale-set', new ScaleSetTool(ctx));
  tools.set('measure-linear', new MeasureLinearTool(ctx));
  tools.set('measure-rect', new MeasureRectTool(ctx));
  tools.set('measure-poly', new MeasurePolyTool(ctx));

  setTool('select');

  // Canvas scale-set event
  canvasState.on('scale-set', (data) => {
    const { scale } = data as { pageIndex: number; scale: PageScale };
    pageScale = scale;
    const cp = (appState.project as unknown as { canvasPages?: { markups: Markup[]; scale?: PageScale }[] }).canvasPages;
    if (cp) cp[currentPageIndex].scale = scale;
    appState.dirty = true;
    updateScaleStatus();
  });

  // Markup transform (move/resize after bake)
  canvasState.on('markup-transform', (data) => {
    const { id } = data as { id: string; node: { x: () => number; y: () => number } };
    const markups = getPageMarkups();
    const markup = markups.find(m => m.id === id);
    if (!markup || !stageManager) return;
    stageManager.bakeTransform(markup);
    appState.dirty = true;
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selId = canvasState.state.selectedMarkupId;
      if (selId && document.activeElement?.tagName !== 'INPUT') {
        deleteMarkup(selId);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault(); zoom(1.25); }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoom(0.8); }
  });

  // React to project load — restore markups
  appState.on('project-loaded', restoreMarkups);
  appState.on('project-new', () => {
    clearCanvas();
    pdfRenderer?.destroy();
    pdfRenderer = null;
    updateLoadStatus('No PDF loaded. Click "Open PDF" to load.');
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (!stageManager || !container) return;
    stageManager.resize(container.clientWidth, container.clientHeight);
  });
  ro.observe(container);

  updateLoadStatus('Open a PDF to start measuring.');
}

// ── Tool management ────────────────────────────────────────────────────────────

function setTool(name: string): void {
  activeTool?.deactivate();
  activeTool = tools.get(name) ?? null;
  activeTool?.activate();
  canvasState.setTool(name as import('../canvas-state/canvasState.ts').CanvasToolType);
  // Update active button styling
  document.querySelectorAll<HTMLElement>('[data-canvas-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.canvasTool === name);
  });
}

// ── PDF loading ────────────────────────────────────────────────────────────────

async function handleLoadPdf(): Promise<void> {
  let bytes: Uint8Array | null = null;
  let name = 'document.pdf';

  if (isTauri()) {
    const { openFileNative } = await import('../tauri/integration.ts');
    const result = await openFileNative('Open PDF', ['pdf']);
    if (!result) return;
    bytes = result.bytes;
    name = result.name;
  } else {
    bytes = await pickPdfFileBrowser();
    if (!bytes) return;
  }

  await loadPdfBytes(bytes, name);
}

async function loadPdfBytes(bytes: Uint8Array, _name: string): Promise<void> {
  if (!stageManager) return;
  updateLoadStatus('Loading PDF…');
  try {
    pdfRenderer?.destroy();
    pdfRenderer = await loadPdf(bytes);
    const total = pdfRenderer.numPages;
    ensureCanvasPages(total);
    currentPageIndex = 0;
    await renderPage(0);
    updateLoadStatus('');
    document.getElementById('canvas-toolbar')?.removeAttribute('data-disabled');
  } catch (err) {
    updateLoadStatus(`Failed to load PDF: ${err}`);
  }
}

async function renderPage(pageIndex: number): Promise<void> {
  if (!pdfRenderer || !stageManager) return;
  currentPageIndex = pageIndex;

  const container = document.getElementById('canvas-container');
  const cw = container?.clientWidth ?? 800;
  const ch = container?.clientHeight ?? 600;

  const { widthPts, heightPts } = await pdfRenderer.getPageSizePts(pageIndex);
  const zoom = fitPageScale(widthPts, heightPts, cw, ch);
  const pageInfo = await pdfRenderer.loadPage(pageIndex, zoom);

  stageManager.setPdfImage(pageInfo.canvas, widthPts, heightPts);
  stageManager.setZoom(zoom);
  canvasState.setZoom(zoom);

  // Restore scale for this page
  const cp = (appState.project as unknown as { canvasPages?: { markups: Markup[]; scale?: PageScale }[] }).canvasPages;
  pageScale = cp?.[pageIndex]?.scale ?? { pointsPerUnit: 0, calibrationUnit: 'ft', calibrated: false };
  updateScaleStatus();

  // Restore markups
  stageManager.clearMarkups();
  const markups = getPageMarkups();
  for (const m of markups) stageManager.addMarkupNode(m);
}

// ── Markup management ─────────────────────────────────────────────────────────

function addMarkup(markup: Markup): void {
  if (!stageManager) return;
  markup.id = generateId();
  stageManager.addMarkupNode(markup);
  saveMarkup(markup);

  // Emit measurement value to estimate scope
  emitMeasurementValue(markup);

  // Ask user if they want to assign this measurement to a task scope input
  showAssignPrompt(markup);
}

function deleteMarkup(id: string): void {
  if (!stageManager) return;
  stageManager.removeMarkupNode(id);
  const cp = (appState.project as unknown as { canvasPages?: { markups: Markup[] }[] }).canvasPages;
  if (cp?.[currentPageIndex]) {
    cp[currentPageIndex].markups = cp[currentPageIndex].markups.filter(m => m.id !== id);
  }
  canvasState.setSelection(null);
  appState.dirty = true;
}

function clearCanvas(): void {
  stageManager?.clearMarkups();
}

function restoreMarkups(): void {
  if (!stageManager) return;
  stageManager.clearMarkups();
  const markups = getPageMarkups();
  for (const m of markups) stageManager.addMarkupNode(m);
}

// ── Measurement value extraction ──────────────────────────────────────────────

/**
 * Extract the numeric measurement value from a markup and propagate it
 * to any assigned scope input via applyMeasurement().
 */
function emitMeasurementValue(markup: Markup): void {
  if (!pageScale.calibrated) return;

  let value = 0;
  const ppi = pageScale.pointsPerUnit;

  if (markup.type === 'measure-linear') {
    const m = markup as import('../model/document.ts').MeasureLinearMarkup;
    const dx = m.x2 - m.x1;
    const dy = m.y2 - m.y1;
    const distPts = Math.sqrt(dx * dx + dy * dy);
    value = distPts / ppi / 12; // convert to feet
  } else if (markup.type === 'measure-rect') {
    const m = markup as import('../model/document.ts').MeasureRectMarkup;
    const areaPts2 = m.width * m.height;
    value = areaPts2 / (ppi * ppi) / 144; // sq ft
  } else if (markup.type === 'measure-poly') {
    const m = markup as import('../model/document.ts').MeasurePolyMarkup;
    let area = 0;
    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i];
      const q = m.points[(i + 1) % m.points.length];
      area += p.x * q.y - q.x * p.y;
    }
    const areaPts2 = Math.abs(area) / 2;
    value = areaPts2 / (ppi * ppi) / 144; // sq ft
  }

  applyMeasurement(markup.id, value);
}

// ── Assign prompt ─────────────────────────────────────────────────────────────

function showAssignPrompt(markup: Markup): void {
  const tasks = appState.project.tasks;
  if (tasks.length === 0) return;

  const roleMap: Record<string, string> = {
    'measure-linear': 'length',
    'measure-rect':   'area',
    'measure-poly':   'area',
  };
  const defaultRole = roleMap[markup.type] ?? 'length';

  const taskOptions = tasks.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  const roleOptions = ['length', 'width', 'height', 'area', 'count']
    .map(r => `<option value="${r}" ${r === defaultRole ? 'selected' : ''}>${r}</option>`).join('');

  const body = `
    <p>Assign this measurement to a task scope input?</p>
    <div class="form-row">
      <label>Task:</label>
      <select id="assign-task" style="flex:1">${taskOptions}</select>
    </div>
    <div class="form-row">
      <label>Role:</label>
      <select id="assign-role">${roleOptions}</select>
    </div>
    <div class="form-row">
      <label>Label:</label>
      <input id="assign-label" type="text" value="${markup.type.replace('measure-', '')} ${markup.id.slice(-4)}" style="flex:1"/>
    </div>`;

  showModal('Assign Measurement', body, 'Assign').then(result => {
    if (!result) return;
    const taskId = (document.getElementById('assign-task') as HTMLSelectElement)?.value ?? '';
    const role = (document.getElementById('assign-role') as HTMLSelectElement)?.value ?? defaultRole;
    const label = (document.getElementById('assign-label') as HTMLInputElement)?.value ?? '';
    if (!taskId) return;

    // Remove any existing assignment for this markup
    appState.project.measureAssignments = appState.project.measureAssignments.filter(a => a.markupId !== markup.id);
    appState.project.measureAssignments.push({
      markupId: markup.id,
      taskId,
      role: role as import('../estimate/project.ts').MeasurementAssignment['role'],
      label: label || `${markup.type} ${markup.id.slice(-4)}`,
    });
    appState.dirty = true;

    // Apply the current measurement value
    emitMeasurementValue(markup);
    appState.emit('scope-changed');
  }).catch(() => { /* user cancelled */ });
}

// ── Zoom / fit ─────────────────────────────────────────────────────────────────

function zoom(factor: number): void {
  if (!stageManager) return;
  const newZoom = Math.max(0.1, Math.min(10, canvasState.state.zoom * factor));
  stageManager.setZoom(newZoom);
  canvasState.setZoom(newZoom);
}

function fitPage(): void {
  if (!pdfRenderer || !stageManager) return;
  const container = document.getElementById('canvas-container');
  const cw = container?.clientWidth ?? 800;
  const ch = container?.clientHeight ?? 600;
  const z = fitPageScale(stageManager.pageWidthPts, stageManager.pageHeightPts, cw, ch);
  stageManager.setZoom(z);
  canvasState.setZoom(z);
}

// ── Tool context ──────────────────────────────────────────────────────────────

function buildToolContext(): ToolContext {
  return {
    get stageManager() { return stageManager!; },
    onMarkupAdd: addMarkup,
    onMarkupUpdate: (id, partial) => {
      const cp = (appState.project as unknown as { canvasPages?: { markups: Markup[] }[] }).canvasPages;
      const markups = cp?.[currentPageIndex]?.markups ?? [];
      const m = markups.find(mx => mx.id === id);
      if (m) Object.assign(m, partial);
      appState.dirty = true;
    },
    getStyle: () => DEFAULT_STROKE_STYLE,
    getPageHeightPts: () => stageManager?.pageHeightPts ?? 792,
    getPageIndex: () => currentPageIndex,
    getScale: () => pageScale,
    getUnits: () => canvasState.state.units,
    showModal,
  };
}

// ── Modal ─────────────────────────────────────────────────────────────────────

let _resolveModal: ((v: string | null) => void) | null = null;

function showModal(title: string, body: string, okText = 'OK'): Promise<string | null> {
  const existing = document.getElementById('canvas-modal');
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id = 'canvas-modal';
  div.className = 'modal-backdrop';
  div.innerHTML = `
    <div class="modal-box" style="max-width:460px">
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" id="canvas-modal-cancel">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      <div class="modal-footer">
        <button class="btn-secondary" id="canvas-modal-cancel2">Cancel</button>
        <button class="btn-primary" id="canvas-modal-ok">${okText}</button>
      </div>
    </div>`;
  document.body.appendChild(div);

  return new Promise(resolve => {
    _resolveModal = resolve;
    div.querySelector('#canvas-modal-ok')?.addEventListener('click', () => { div.remove(); resolve('ok'); });
    div.querySelector('#canvas-modal-cancel')?.addEventListener('click', () => { div.remove(); resolve(null); });
    div.querySelector('#canvas-modal-cancel2')?.addEventListener('click', () => { div.remove(); resolve(null); });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickPdfFileBrowser(): Promise<Uint8Array | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      resolve(new Uint8Array(await file.arrayBuffer()));
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function updateLoadStatus(msg: string): void {
  const el = document.getElementById('canvas-load-status');
  if (el) el.textContent = msg;
}

function updateScaleStatus(): void {
  const el = document.getElementById('canvas-scale-status');
  if (!el) return;
  if (pageScale.calibrated) {
    const ppi = pageScale.pointsPerUnit;
    const reInch = ppi / 72;
    el.textContent = `Scale: 1" = ${(reInch >= 12 ? (reInch / 12).toFixed(1) + "'" : reInch.toFixed(2) + '"')}`;
  } else {
    el.textContent = 'Scale: not set';
  }
}

// Suppress unused
void computeScale;
void _resolveModal;
