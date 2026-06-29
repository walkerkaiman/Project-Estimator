/**
 * Project file I/O.
 *
 * Projects are saved as `.estimate` files (JSON).
 * In Tauri, the native save/open dialogs are used.
 * In the browser, the File System Access API or a blob download is used.
 */

import type { EstimateProject } from '../estimate/project.ts';
import { ESTIMATE_FILE_VERSION } from '../estimate/project.ts';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ── Save ─────────────────────────────────────────────────────────────────────

/** Serialize project to JSON string. */
function serialise(project: EstimateProject): string {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2);
}

/**
 * Open a native "Save As" dialog and write the file.
 * Returns the path that was saved, or null if the user cancelled.
 */
export async function saveProjectAs(project: EstimateProject): Promise<string | null> {
  const json = serialise(project);

  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      title: 'Save Estimate',
      defaultPath: `${project.name}.estimate`,
      filters: [{ name: 'Estimate Files', extensions: ['estimate'] }],
    });
    if (!path) return null;
    await writeTextFile(path, json);
    return path;
  }

  // Browser fallback
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name}.estimate`;
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

/**
 * Write directly to a path that was previously chosen (quick-save).
 * Tauri only.
 */
export async function saveProjectToPath(project: EstimateProject, path: string): Promise<void> {
  if (!isTauri()) return;
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  await writeTextFile(path, serialise(project));
}

// ── Open ─────────────────────────────────────────────────────────────────────

export interface OpenResult {
  project: EstimateProject;
  path: string | null;
}

/**
 * Open a native "Open" dialog and read the file.
 * Returns null if the user cancelled.
 */
export async function openProject(): Promise<OpenResult | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const result = await open({
      title: 'Open Estimate',
      multiple: false,
      filters: [{ name: 'Estimate Files', extensions: ['estimate'] }],
    });
    if (!result) return null;
    const path = typeof result === 'string' ? result : result[0];
    const raw = await readTextFile(path);
    return { project: parseProject(raw), path };
  }

  // Browser — use <input type="file">
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.estimate';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const raw = await file.text();
      resolve({ project: parseProject(raw), path: null });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Read a project from a known path (Tauri recent-files).
 */
export async function openProjectFromPath(path: string): Promise<EstimateProject> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  return parseProject(await readTextFile(path));
}

// ── Parse / migrate ──────────────────────────────────────────────────────────

function parseProject(raw: string): EstimateProject {
  const data = JSON.parse(raw) as Partial<EstimateProject>;
  return migrateProject(data);
}

function migrateProject(raw: Partial<EstimateProject>): EstimateProject {
  if ((raw.fileVersion ?? 0) > ESTIMATE_FILE_VERSION) {
    console.warn('Project was saved by a newer version of the app.');
  }
  return {
    fileVersion: raw.fileVersion ?? ESTIMATE_FILE_VERSION,
    name: raw.name ?? 'Untitled Project',
    description: raw.description ?? '',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
    phases: raw.phases ?? [],
    tasks: raw.tasks ?? [],
    snapshot: raw.snapshot ?? { takenAt: new Date().toISOString(), materials: [] },
    snapshotStale: raw.snapshotStale ?? false,
    scope: raw.scope ?? [],
  };
}
