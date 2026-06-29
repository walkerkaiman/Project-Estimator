/**
 * Tauri-specific integration helpers.
 * All exports gracefully no-op in browser environments.
 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Open a file picker for the given extensions.
 * Returns { bytes, name, path } or null if cancelled.
 */
export async function openFileNative(
  title: string,
  extensions: string[],
): Promise<{ bytes: Uint8Array; name: string; path: string } | null> {
  if (!isTauri()) return null;
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const result = await open({ title, multiple: false, filters: [{ name: 'Files', extensions }] });
    if (!result) return null;
    const path = typeof result === 'string' ? result : result[0];
    const bytes = await readFile(path);
    const name = path.split(/[\\/]/).pop() ?? path;
    return { bytes, name, path };
  } catch (err) {
    console.error('openFileNative failed:', err);
    return null;
  }
}
