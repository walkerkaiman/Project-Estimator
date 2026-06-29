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
import { isTauri } from './tauri/integration.ts';
import { refreshSnapshotPrices } from './estimate/snapshot.ts';

async function init(): Promise<void> {
  // Load the catalog (app-data or localStorage or example)
  appState.catalog = await loadCatalog();
  appState.emit('catalog-loaded');

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

  // Warn before closing with unsaved changes
  window.addEventListener('beforeunload', e => {
    if (appState.dirty) e.preventDefault();
  });

  // On close in Tauri, nothing extra needed right now
  void isTauri();
}

function handleNewProject(): void {
  if (appState.dirty && !confirm('Discard unsaved changes and start a new project?')) return;
  appState.newProjectFromCatalog();
}

function handleRefreshPrices(): void {
  if (!confirm('Refresh material prices and labor rates from the master catalog?\n\nThis will update your price snapshot but keep all scope inputs.')) return;
  appState.project = refreshSnapshotPrices(appState.project, appState.catalog);
  appState.dirty = true;
  appState.emit('project-changed');
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

void init();
