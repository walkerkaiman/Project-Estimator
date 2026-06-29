/**
 * PDF canvas panel — the measurement workspace.
 *
 * Manages:
 *   • Loading a PDF (via file picker or drag-drop)
 *   • Multi-page navigation (prev / next, page indicator)
 *   • Rendering pages via pdf.js
 *   • Hosting the Konva stage with measurement + count tools
 *   • Per-page markup storage within the project
 *   • Measurement → scope assignment (linear, area, count totals)
 */

import { canvasState } from '../canvas-state/canvasState.ts';
import { createKonvaStageManager, type KonvaStageManager } from '../canvas/stage.ts';
import { loadPdf, fitPageScale, type PdfRenderer } from '../pdf/renderer.ts';
import { SelectTool } from '../tools/selectTool.ts';
import { PanTool } from '../tools/panTool.ts';
import { ScaleSetTool } from '../tools/scaleSetTool.ts';
import { MeasureLinearTool } from '../tools/measureLinearTool.ts';
import { MeasureRectTool } from '../tools/measureRectTool.ts';
import { MeasurePolyTool } from '../tools/measurePolyTool.ts';
import { CountTool } from '../tools/countTool.ts';
import { BaseTool, type ToolContext } from '../tools/baseTool.ts';
import type { Markup, PageScale, CountCategory, CountMarkup } from '../model/document.ts';
import { DEFAULT_STROKE_STYLE, COUNT_SYMBOLS, COUNT_COLORS, generateId } from '../model/document.ts';
import { computeScale } from '../measure/scale.ts';
import { applyMeasurement } from '../estimate/measureAssign.ts';
import { appState } from '../appState.ts';
import { isTauri } from '../tauri/integration.ts';

// ── State ──────────────────────────────────────────────────────────────────────

let stageManager: KonvaStageManager | null = null;
let pdfRenderer: PdfRenderer | null = null;
let activeTool: BaseTool | null = null;
let tools: Map<string, BaseTool> = new Map();
let currentPageIndex = 0;
let totalPages = 0;
let pageScale: PageScale = { pointsPerUnit: 0, calibrationUnit: 'ft', calibrated: false };

// Scale gate — same pattern as RedlinePDF
const MEASURE_TOOLS = ['measure-linear', 'measure-rect', 'measure-poly', 'count'] as const;
let pendingMeasureTool: string | null = null;

// Count tool state
let countCategories: CountCategory[] = [];
let activeCountCategoryId: string | null = null;
let countSymbolSize = 12;

// ── Per-page canvas data (stored piggy-backed on project) ─────────────────────

type CanvasPageData = { markups: Markup[]; scale?: PageScale };
type ProjectWithCanvas = typeof appState.project & { canvasPages?: CanvasPageData[] };

function canvasPages(): CanvasPageData[] {
  return (appState.project as ProjectWithCanvas).canvasPages ?? [];
}

function getPageMarkups(): Markup[] {
  return canvasPages()[currentPageIndex]?.markups ?? [];
}

function ensureCanvasPages(n: number): void {
  const proj = appState.project as ProjectWithCanvas;
  if (!proj.canvasPages) proj.canvasPages = [];
  while (proj.canvasPages.length < n) {
    proj.canvasPages.push({ markups: [] });
  }
}

function saveMarkup(markup: Markup): void {
  const pages = canvasPages();
  if (!pages[currentPageIndex]) return;
  pages[currentPageIndex].markups.push(markup);
  appState.dirty = true;
}

// ── Init ───────────────────────────────────────────────────────────────────────

export function initPdfCanvas(): void {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  stageManager = createKonvaStageManager('canvas-container');
  setupWheelZoom();

  // File + tool buttons
  document.getElementById('btn-load-pdf')?.addEventListener('click', () => void handleLoadPdf());
  document.getElementById('btn-tool-select')?.addEventListener('click', () => setTool('select'));
  document.getElementById('btn-tool-pan')?.addEventListener('click', () => setTool('pan'));
  document.getElementById('btn-tool-scale')?.addEventListener('click', () => setTool('scale-set'));
  document.getElementById('btn-tool-linear')?.addEventListener('click', () => setTool('measure-linear'));
  document.getElementById('btn-tool-rect')?.addEventListener('click', () => setTool('measure-rect'));
  document.getElementById('btn-tool-poly')?.addEventListener('click', () => setTool('measure-poly'));
  document.getElementById('btn-tool-count')?.addEventListener('click', () => setTool('count'));

  // Zoom & fit
  document.getElementById('btn-canvas-zoom-in')?.addEventListener('click', () => zoom(1.25));
  document.getElementById('btn-canvas-zoom-out')?.addEventListener('click', () => zoom(0.8));
  document.getElementById('btn-canvas-fit')?.addEventListener('click', fitPage);

  // Page navigation
  document.getElementById('btn-prev-page')?.addEventListener('click', () => void navigatePage(-1));
  document.getElementById('btn-next-page')?.addEventListener('click', () => void navigatePage(1));

  // Build tools
  const ctx = buildToolContext();
  tools.set('select', new SelectTool(ctx));
  tools.set('pan', new PanTool(ctx));
  tools.set('scale-set', new ScaleSetTool(ctx));
  tools.set('measure-linear', new MeasureLinearTool(ctx));
  tools.set('measure-rect', new MeasureRectTool(ctx));
  tools.set('measure-poly', new MeasurePolyTool(ctx));
  tools.set('count', new CountTool(ctx));

  setTool('select');

  // Canvas scale-set event — update scale state, then auto-activate pending tool
  canvasState.on('scale-set', (data) => {
    const { scale } = data as { pageIndex: number; scale: PageScale };
    pageScale = scale;
    const pages = canvasPages();
    if (pages[currentPageIndex]) pages[currentPageIndex].scale = scale;
    appState.dirty = true;
    updateScaleStatus();

    if (pendingMeasureTool) {
      const tool = pendingMeasureTool;
      pendingMeasureTool = null;
      const toolLabel: Record<string, string> = {
        'measure-linear': 'Linear Measure',
        'measure-rect': 'Rectangle Area',
        'measure-poly': 'Polygon Area',
        'count': 'Count',
      };
      showToast(`Scale set! ${toolLabel[tool] ?? tool} tool is now active.`, 'info');
      setTool(tool);
    } else {
      showToast('Scale set.', 'info');
    }
  });

  // Markup transform (move/resize after bake)
  canvasState.on('markup-transform', (data) => {
    const { id } = data as { id: string };
    const markups = getPageMarkups();
    const markup = markups.find(m => m.id === id);
    if (!markup || !stageManager) return;
    stageManager.bakeTransform(markup);
    // Re-emit updated measurement value if assigned
    emitMeasurementValue(markup);
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
    // Tool shortcuts (only when not typing in an input)
    if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'h' || e.key === 'H') setTool('pan');
    }
    // Arrow keys for page navigation when no input is focused
    if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') void navigatePage(-1);
      if (e.key === 'ArrowRight' || e.key === 'PageDown') void navigatePage(1);
    }
  });

  // React to project load/new
  appState.on('project-loaded', () => {
    const proj = appState.project as ProjectWithCanvas;
    // Restore count categories from project if saved
    if ((proj as unknown as { countCategories?: CountCategory[] }).countCategories) {
      countCategories = (proj as unknown as { countCategories?: CountCategory[] }).countCategories!;
    }
    restoreMarkups();
  });
  appState.on('project-new', () => {
    clearCanvas();
    pdfRenderer?.destroy();
    pdfRenderer = null;
    totalPages = 0;
    currentPageIndex = 0;
    updatePageNav();
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

// ── Tool management ─────────────────────────────────────────────────────────────

function setTool(name: string): void {
  // Gate: measure tools require a calibrated page scale
  if ((MEASURE_TOOLS as readonly string[]).includes(name) && !pageScale.calibrated) {
    pendingMeasureTool = name;
    setTool('scale-set');   // recurse once — scale-set is always allowed
    showToast(
      'Scale not set. Click two points on a known dimension, enter the real distance, then your tool will activate.',
      'warn',
      6000,
    );
    return;
  }

  // Clear pending if user switches to a non-measure, non-scale-set tool
  if (name !== 'scale-set' && !(MEASURE_TOOLS as readonly string[]).includes(name)) {
    pendingMeasureTool = null;
  }

  activeTool?.deactivate();
  activeTool = tools.get(name) ?? null;
  activeTool?.activate();
  canvasState.setTool(name as import('../canvas-state/canvasState.ts').CanvasToolType);
  document.querySelectorAll<HTMLElement>('[data-canvas-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.canvasTool === name);
  });
  // Show/hide count panel
  const countPanel = document.getElementById('count-panel');
  if (countPanel) {
    countPanel.style.display = name === 'count' ? 'flex' : 'none';
    if (name === 'count') renderCountPanel();
  }
}

// ── Page navigation ─────────────────────────────────────────────────────────────

async function navigatePage(delta: number): Promise<void> {
  if (!pdfRenderer) return;
  const next = currentPageIndex + delta;
  if (next < 0 || next >= totalPages) return;
  await renderPage(next);
}

function updatePageNav(): void {
  const prevBtn = document.getElementById('btn-prev-page') as HTMLButtonElement | null;
  const nextBtn = document.getElementById('btn-next-page') as HTMLButtonElement | null;
  const indicator = document.getElementById('canvas-page-indicator');

  const hasPdf = totalPages > 0;
  if (prevBtn) prevBtn.disabled = !hasPdf || currentPageIndex <= 0;
  if (nextBtn) nextBtn.disabled = !hasPdf || currentPageIndex >= totalPages - 1;
  if (indicator) indicator.textContent = hasPdf ? `${currentPageIndex + 1} / ${totalPages}` : '— / —';
}

// ── PDF loading ─────────────────────────────────────────────────────────────────

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
    totalPages = pdfRenderer.numPages;
    ensureCanvasPages(totalPages);
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
  pendingMeasureTool = null; // reset on page switch — each page gates independently

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
  const pages = canvasPages();
  pageScale = pages[pageIndex]?.scale ?? { pointsPerUnit: 0, calibrationUnit: 'ft', calibrated: false };
  updateScaleStatus();

  // Restore markups
  stageManager.clearMarkups();
  for (const m of getPageMarkups()) stageManager.addMarkupNode(m);

  updatePageNav();
}

// ── Markup management ──────────────────────────────────────────────────────────

function addMarkup(markup: Markup): void {
  if (!stageManager) return;
  markup.id = generateId();
  stageManager.addMarkupNode(markup);
  saveMarkup(markup);
  emitMeasurementValue(markup);
  showAssignPrompt(markup);
}

function deleteMarkup(id: string): void {
  if (!stageManager) return;
  stageManager.removeMarkupNode(id);
  const pages = canvasPages();
  if (pages[currentPageIndex]) {
    pages[currentPageIndex].markups = pages[currentPageIndex].markups.filter(m => m.id !== id);
  }
  canvasState.setSelection(null);
  appState.dirty = true;

  // If it was a count markup, re-emit the new total for its category
  const allMarkups = canvasPages().flatMap(p => p.markups);
  const deletedMarkup = allMarkups.find(m => m.id === id);
  if (deletedMarkup?.type === 'count') {
    reemitCountTotal((deletedMarkup as CountMarkup).categoryId);
  }
}

function clearCanvas(): void {
  stageManager?.clearMarkups();
}

function restoreMarkups(): void {
  if (!stageManager) return;
  stageManager.clearMarkups();
  for (const m of getPageMarkups()) stageManager.addMarkupNode(m);
}

// ── Count tool ─────────────────────────────────────────────────────────────────

/**
 * Called by the CountTool when a marker is placed.
 * Renders it, saves it, then re-emits the running total for its category.
 */
function handleCountAdd(markup: CountMarkup): void {
  if (!stageManager) return;
  stageManager.addMarkupNode(markup);
  saveMarkup(markup);
  // Update count panel badge immediately
  renderCountPanel();
  // Apply count total to any assigned scope
  reemitCountTotal(markup.categoryId);
  // Offer assignment if not yet assigned
  const virtualId = countVirtualId(currentPageIndex, markup.categoryId);
  if (!appState.project.measureAssignments.find(a => a.markupId === virtualId)) {
    showCountAssignPrompt(markup.categoryId);
  }
}

/** Stable virtual ID that represents the total count for a (page, category) pair. */
function countVirtualId(pageIndex: number, categoryId: string): string {
  return `count-pg${pageIndex}-${categoryId}`;
}

/** Count how many markers exist for a category on the current page and push to scope. */
function reemitCountTotal(categoryId: string): void {
  const total = getPageMarkups().filter(
    m => m.type === 'count' && (m as CountMarkup).categoryId === categoryId
  ).length;
  const virtualId = countVirtualId(currentPageIndex, categoryId);
  applyMeasurement(virtualId, total);
  renderCountPanel();
}

function getActiveCountCategory(): CountCategory | null {
  return countCategories.find(c => c.id === activeCountCategoryId) ?? countCategories[0] ?? null;
}

function ensureDefaultCategory(): void {
  if (countCategories.length === 0) {
    countCategories.push({
      id: generateId(),
      name: 'Item',
      symbol: COUNT_SYMBOLS[0],
      color: COUNT_COLORS[0],
    });
    activeCountCategoryId = countCategories[0].id;
  }
}

function addCountCategory(): void {
  const idx = countCategories.length % COUNT_COLORS.length;
  const cat: CountCategory = {
    id: generateId(),
    name: `Item ${countCategories.length + 1}`,
    symbol: COUNT_SYMBOLS[idx % COUNT_SYMBOLS.length],
    color: COUNT_COLORS[idx],
  };
  countCategories.push(cat);
  activeCountCategoryId = cat.id;
  renderCountPanel();
}

function deleteCountCategory(id: string): void {
  countCategories = countCategories.filter(c => c.id !== id);
  if (activeCountCategoryId === id) {
    activeCountCategoryId = countCategories[0]?.id ?? null;
  }
  renderCountPanel();
}

function renderCountPanel(): void {
  const panel = document.getElementById('count-panel');
  if (!panel) return;

  ensureDefaultCategory();

  const currentMarkups = getPageMarkups();
  const catChips = countCategories.map(cat => {
    const count = currentMarkups.filter(
      m => m.type === 'count' && (m as CountMarkup).categoryId === cat.id
    ).length;
    const isActive = cat.id === (activeCountCategoryId ?? countCategories[0].id);
    return `
      <div class="count-cat-chip ${isActive ? 'active' : ''}" data-cat-id="${cat.id}" title="${cat.name}">
        <span class="count-cat-dot" style="background:${cat.color}"></span>
        <span class="count-cat-name">${cat.name}</span>
        <span class="count-cat-badge">${count}</span>
        <button class="count-cat-assign" data-assign-cat="${cat.id}" title="Assign count to scope input">→</button>
        <button class="count-cat-del" data-del-cat="${cat.id}" title="Delete category">✕</button>
      </div>`;
  }).join('');

  panel.innerHTML = `
    <span class="count-panel-label">Categories:</span>
    ${catChips}
    <button class="canvas-tb-btn" id="btn-add-count-cat" title="Add Category">+</button>`;

  // Wire events
  panel.querySelectorAll('.count-cat-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.dataset.delCat || target.dataset.assignCat) return;
      const catId = (chip as HTMLElement).dataset.catId;
      if (catId) { activeCountCategoryId = catId; renderCountPanel(); }
    });
  });
  panel.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', () => deleteCountCategory((btn as HTMLElement).dataset.delCat!));
  });
  panel.querySelectorAll('[data-assign-cat]').forEach(btn => {
    btn.addEventListener('click', () => showCountAssignPrompt((btn as HTMLElement).dataset.assignCat!));
  });
  document.getElementById('btn-add-count-cat')?.addEventListener('click', addCountCategory);
}

// ── Measurement value extraction ───────────────────────────────────────────────

function emitMeasurementValue(markup: Markup): void {
  if (markup.type === 'count') {
    // Count is handled by reemitCountTotal; skip here
    return;
  }
  if (!pageScale.calibrated) return;

  let value = 0;
  const ppi = pageScale.pointsPerUnit;

  if (markup.type === 'measure-linear') {
    const m = markup as import('../model/document.ts').MeasureLinearMarkup;
    const dx = m.x2 - m.x1;
    const dy = m.y2 - m.y1;
    value = Math.sqrt(dx * dx + dy * dy) / ppi / 12; // feet
  } else if (markup.type === 'measure-rect') {
    const m = markup as import('../model/document.ts').MeasureRectMarkup;
    value = (m.width * m.height) / (ppi * ppi) / 144; // sq ft
  } else if (markup.type === 'measure-poly') {
    const m = markup as import('../model/document.ts').MeasurePolyMarkup;
    let area = 0;
    for (let i = 0; i < m.points.length; i++) {
      const p = m.points[i];
      const q = m.points[(i + 1) % m.points.length];
      area += p.x * q.y - q.x * p.y;
    }
    value = Math.abs(area) / 2 / (ppi * ppi) / 144; // sq ft
  }

  applyMeasurement(markup.id, value);
}

// ── Assign prompts ─────────────────────────────────────────────────────────────

function showAssignPrompt(markup: Markup): void {
  if (markup.type === 'count') return; // count uses showCountAssignPrompt
  const tasks = appState.project.tasks;
  if (tasks.length === 0) return;

  const roleMap: Record<string, string> = {
    'measure-linear': 'length',
    'measure-rect':   'area',
    'measure-poly':   'area',
  };
  const defaultRole = roleMap[markup.type] ?? 'length';

  const taskOptions = tasks.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  const roleOptions = ['length', 'width', 'height', 'area']
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

    appState.project.measureAssignments = appState.project.measureAssignments.filter(a => a.markupId !== markup.id);
    appState.project.measureAssignments.push({
      markupId: markup.id,
      taskId,
      role: role as import('../estimate/project.ts').MeasurementAssignment['role'],
      label: label || `${markup.type} ${markup.id.slice(-4)}`,
    });
    appState.dirty = true;
    emitMeasurementValue(markup);
    appState.emit('scope-changed');
  }).catch(() => { /* user cancelled */ });
}

function showCountAssignPrompt(categoryId: string): void {
  const tasks = appState.project.tasks;
  if (tasks.length === 0) return;

  const cat = countCategories.find(c => c.id === categoryId);
  if (!cat) return;

  const virtualId = countVirtualId(currentPageIndex, categoryId);
  const existing = appState.project.measureAssignments.find(a => a.markupId === virtualId);

  const taskOptions = tasks.map(t =>
    `<option value="${t.id}" ${existing?.taskId === t.id ? 'selected' : ''}>${t.name}</option>`
  ).join('');

  const count = getPageMarkups().filter(
    m => m.type === 'count' && (m as CountMarkup).categoryId === categoryId
  ).length;

  const body = `
    <p>Assign <strong>${cat.name}</strong> count (<strong>${count}</strong> markers) to a task scope input.</p>
    <p style="color:var(--color-text-muted);font-size:12px">The live count will update automatically as markers are added or removed.</p>
    <div class="form-row" style="margin-top:12px">
      <label>Task:</label>
      <select id="count-assign-task" style="flex:1">${taskOptions}</select>
    </div>
    <div class="form-row">
      <label>Label:</label>
      <input id="count-assign-label" type="text" value="${existing?.label ?? cat.name + ' count'}" style="flex:1"/>
    </div>`;

  showModal(`Assign Count: ${cat.name}`, body, 'Assign').then(result => {
    if (!result) return;
    const taskId = (document.getElementById('count-assign-task') as HTMLSelectElement)?.value ?? '';
    const label = (document.getElementById('count-assign-label') as HTMLInputElement)?.value ?? cat.name;
    if (!taskId) return;

    appState.project.measureAssignments = appState.project.measureAssignments.filter(a => a.markupId !== virtualId);
    appState.project.measureAssignments.push({
      markupId: virtualId,
      taskId,
      role: 'count',
      label,
    });
    appState.dirty = true;
    reemitCountTotal(categoryId);
  }).catch(() => { /* cancelled */ });
}

// ── Zoom / fit ──────────────────────────────────────────────────────────────────

let wheelDebounce: ReturnType<typeof setTimeout> | null = null;

function setupWheelZoom(): void {
  if (!stageManager) return;
  const { stage } = stageManager;

  stage.container().addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();

    const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const oldScale = stage.scaleX();
    const newScale = Math.max(0.1, Math.min(20, oldScale * scaleFactor));

    // Zoom toward the cursor position immediately (visual feedback)
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
    stage.batchDraw();
    canvasState.setZoom(newScale);

    // Debounced: re-render PDF at new resolution for crisp text/lines
    if (wheelDebounce) clearTimeout(wheelDebounce);
    wheelDebounce = setTimeout(async () => {
      if (!pdfRenderer || !stageManager) return;
      const currentScale = stage.scaleX();
      const pageInfo = await pdfRenderer.loadPage(currentPageIndex, currentScale);
      stageManager.updatePdfCanvas(pageInfo.canvas);
    }, 250);
  }, { passive: false });
}

function zoom(factor: number): void {
  if (!stageManager) return;
  const newZoom = Math.max(0.1, Math.min(20, canvasState.state.zoom * factor));
  stageManager.setZoom(newZoom);
  canvasState.setZoom(newZoom);
  // Debounced hi-res re-render after button zoom too
  if (wheelDebounce) clearTimeout(wheelDebounce);
  wheelDebounce = setTimeout(async () => {
    if (!pdfRenderer || !stageManager) return;
    const pageInfo = await pdfRenderer.loadPage(currentPageIndex, newZoom);
    stageManager.updatePdfCanvas(pageInfo.canvas);
  }, 250);
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

// ── Tool context ───────────────────────────────────────────────────────────────

function buildToolContext(): ToolContext {
  return {
    get stageManager() { return stageManager!; },
    onMarkupAdd: addMarkup,
    onMarkupUpdate: (id, partial) => {
      const pages = canvasPages();
      const m = pages[currentPageIndex]?.markups.find(mx => mx.id === id);
      if (m) Object.assign(m, partial);
      appState.dirty = true;
    },
    getStyle: () => DEFAULT_STROKE_STYLE,
    getPageHeightPts: () => stageManager?.pageHeightPts ?? 792,
    getPageIndex: () => currentPageIndex,
    getScale: () => pageScale,
    getUnits: () => canvasState.state.units,
    showModal,
    // Count tool
    getActiveCountCategory,
    getCountSymbolSize: () => countSymbolSize,
    onCountAdd: handleCountAdd,
  };
}

// ── Modal ──────────────────────────────────────────────────────────────────────

let _resolveModal: ((v: string | null) => void) | null = null;

function showModal(title: string, body: string, okText = 'OK'): Promise<string | null> {
  document.getElementById('canvas-modal')?.remove();

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

// ── Helpers ────────────────────────────────────────────────────────────────────

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
    const reInch = pageScale.pointsPerUnit / 72;
    el.textContent = `Scale: 1" = ${reInch >= 12 ? (reInch / 12).toFixed(1) + "'" : reInch.toFixed(2) + '"'}`;
    el.classList.remove('scale-unset');
  } else {
    el.textContent = 'Scale: not set — click Set Scale tool to calibrate';
    el.classList.add('scale-unset');
  }
}

function showToast(message: string, type: 'info' | 'warn' = 'info', duration = 4000): void {
  let container = document.getElementById('canvas-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'canvas-toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `canvas-toast canvas-toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Fade in
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

// Suppress unused import warning
void computeScale;
void _resolveModal;
