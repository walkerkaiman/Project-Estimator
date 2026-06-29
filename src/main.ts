/**
 * Application entry point.
 */

import './style.css';
import { appState } from './appState.ts';
import { loadCatalog } from './storage/catalogStore.ts';
import { openProject, saveProjectAs, saveProjectToPath } from './storage/projectStore.ts';
import { initEstimateUI } from './ui/estimateView.ts';
import { openCatalogManager } from './ui/catalogManager.ts';
import { openBidExport } from './ui/bidExport.ts';
import { initPdfCanvas } from './ui/pdfCanvas.ts';
import { isTauri } from './tauri/integration.ts';
import { refreshSnapshotPrices } from './estimate/snapshot.ts';
import { showConfirm } from './ui/modal.ts';

async function init(): Promise<void> {
  // Load the catalog (app-data or localStorage or example)
  appState.catalog = await loadCatalog();
  // Pre-seed the project from the catalog so phases are visible immediately on first run
  appState.newProjectFromCatalog();

  // Wire toolbar
  document.getElementById('btn-new-project')?.addEventListener('click', handleNewProject);
  document.getElementById('btn-refresh-prices')?.addEventListener('click', handleRefreshPrices);
  document.getElementById('btn-catalog')?.addEventListener('click', openCatalogManager);
  document.getElementById('btn-export-bid')?.addEventListener('click', openBidExport);
  document.getElementById('btn-open-project')?.addEventListener('click', () => void handleOpenProject());
  document.getElementById('btn-save-project')?.addEventListener('click', () => void handleSaveProject());
  document.getElementById('btn-save-project-as')?.addEventListener('click', () => void handleSaveProjectAs());

  // Init the estimate workspace UI
  initEstimateUI();

  // Init the PDF measurement canvas panel
  initPdfCanvas();

  // Draggable split handle
  initSplitPanel();

  // Warn before closing with unsaved changes
  window.addEventListener('beforeunload', e => {
    if (appState.dirty) e.preventDefault();
  });

  // On close in Tauri, nothing extra needed right now
  void isTauri();
}

function handleNewProject(): void {
  if (!appState.dirty) { appState.newProjectFromCatalog(); return; }
  void showConfirm('Discard unsaved changes and start a new project?', 'Discard').then(ok => {
    if (ok) appState.newProjectFromCatalog();
  });
}

function handleRefreshPrices(): void {
  void showConfirm('Refresh material prices and labor rates from the master catalog? Scope inputs are kept.', 'Refresh').then(ok => {
    if (!ok) return;
    appState.project = refreshSnapshotPrices(appState.project, appState.catalog);
    appState.dirty = true;
    appState.emit('project-changed');
  });
}

async function handleOpenProject(): Promise<void> {
  const result = await openProject();
  if (!result) return;
  appState.project = result.project;
  appState.currentProjectPath = result.path;
  appState.dirty = false;
  appState.emit('project-loaded');
}

async function handleSaveProject(): Promise<void> {
  if (appState.currentProjectPath) {
    await saveProjectToPath(appState.project, appState.currentProjectPath);
    appState.dirty = false;
    return;
  }
  await handleSaveProjectAs();
}

async function handleSaveProjectAs(): Promise<void> {
  const path = await saveProjectAs(appState.project);
  if (path) {
    appState.currentProjectPath = path;
    appState.dirty = false;
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 's' && !e.shiftKey) {
    e.preventDefault();
    void handleSaveProject();
  }
  if (ctrl && e.key === 's' && e.shiftKey) {
    e.preventDefault();
    void handleSaveProjectAs();
  }
  if (ctrl && e.key === 'o') {
    e.preventDefault();
    void handleOpenProject();
  }
  if (ctrl && e.key === 'n') {
    e.preventDefault();
    handleNewProject();
  }
});

function initSplitPanel(): void {
  const handle = document.getElementById('split-handle');
  const canvasPanel = document.getElementById('canvas-panel');
  const content = document.getElementById('content');
  if (!handle || !canvasPanel || !content) return;

  let dragging = false;
  handle.addEventListener('mousedown', () => { dragging = true; handle.classList.add('dragging'); });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const split = document.getElementById('split-content');
    if (!split) return;
    const rect = split.getBoundingClientRect();
    const totalW = rect.width;
    const leftW = e.clientX - rect.left;
    const pct = Math.max(20, Math.min(80, (leftW / totalW) * 100));
    content.style.flex = `0 0 ${pct}%`;
    canvasPanel.style.width = `${100 - pct}%`;
  });
  window.addEventListener('mouseup', () => { dragging = false; handle.classList.remove('dragging'); });
}

void init();
