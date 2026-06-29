/**
 * Catalog persistence layer.
 *
 * In Tauri:  reads/writes catalog.json to the app-data directory.
 * In browser: falls back to localStorage (capped at ~5 MB — fine for catalog).
 *
 * The app ships a synthetic example catalog (no real prices). The importer
 * script (scripts/importFableXlsx.ts) generates a real catalog.json in the
 * app-data directory; that file is git-ignored.
 */

import type { Catalog } from '../estimate/catalog.ts';
import { CATALOG_VERSION, emptyCatalog } from '../estimate/catalog.ts';
import { EXAMPLE_CATALOG } from '../estimate/catalog-example.ts';

const LS_KEY = 'project-estimator:catalog';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function getTauriCatalogPath(): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path');
  return join(await appDataDir(), 'catalog.json');
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Load the catalog from app-data (Tauri) or localStorage (browser). */
export async function loadCatalog(): Promise<Catalog> {
  try {
    if (isTauri()) {
      const { readTextFile, exists } = await import('@tauri-apps/plugin-fs');
      const path = await getTauriCatalogPath();
      if (await exists(path)) {
        const raw = await readTextFile(path);
        return migrateCatalog(JSON.parse(raw) as Catalog);
      }
    } else {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return migrateCatalog(JSON.parse(raw) as Catalog);
    }
  } catch (err) {
    console.warn('Failed to load catalog, falling back to example:', err);
  }
  // First run — return a copy of the example catalog (zero prices).
  return structuredClone(EXAMPLE_CATALOG);
}

/** Save the catalog to app-data (Tauri) or localStorage (browser). */
export async function saveCatalog(catalog: Catalog): Promise<void> {
  catalog.version = CATALOG_VERSION;
  const json = JSON.stringify(catalog, null, 2);
  if (isTauri()) {
    const { writeTextFile, mkdir } = await import('@tauri-apps/plugin-fs');
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const dir = await appDataDir();
    await mkdir(dir, { recursive: true });
    const path = await join(dir, 'catalog.json');
    await writeTextFile(path, json);
  } else {
    localStorage.setItem(LS_KEY, json);
  }
}

/** Reset catalog back to the built-in example (erases all real data). */
export async function resetCatalogToExample(): Promise<void> {
  await saveCatalog(structuredClone(EXAMPLE_CATALOG));
}

// ── Migration ─────────────────────────────────────────────────────────────────

function migrateCatalog(raw: Partial<Catalog>): Catalog {
  const base = emptyCatalog();
  return {
    version: raw.version ?? CATALOG_VERSION,
    materials: raw.materials ?? base.materials,
    vendors: raw.vendors ?? base.vendors,
    units: raw.units ?? base.units,
    phases: raw.phases ?? base.phases,
    tasks: raw.tasks ?? base.tasks,
  };
}
