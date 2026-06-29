/**
 * Global application state & event bus.
 *
 * Keeps the catalog, active project, and UI state in one place.
 * Components communicate via typed events (EventEmitter pattern).
 */

import type { Catalog } from './estimate/catalog.ts';
import type { EstimateProject } from './estimate/project.ts';
import { emptyCatalog } from './estimate/catalog.ts';
import { newProject } from './estimate/project.ts';

// ── Event map ────────────────────────────────────────────────────────────────

export type AppEvent =
  | 'catalog-loaded'
  | 'catalog-changed'
  | 'project-new'
  | 'project-loaded'
  | 'project-changed'
  | 'scope-changed'
  | 'totals-updated';

type Listener = () => void;

// ── State ────────────────────────────────────────────────────────────────────

class AppState {
  catalog: Catalog = emptyCatalog();
  project: EstimateProject = newProject();

  /** Path of the currently open project file (Tauri), or null. */
  currentProjectPath: string | null = null;

  /** Whether there are unsaved changes. */
  dirty = false;

  private listeners: Map<AppEvent, Set<Listener>> = new Map();

  on(event: AppEvent, listener: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off(event: AppEvent, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: AppEvent): void {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }
}

export const appState = new AppState();
