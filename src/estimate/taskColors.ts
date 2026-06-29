/**
 * Stable, deterministic color assignment for tasks.
 *
 * Colors are derived from the task ID so they never change when tasks
 * are reordered, and they are consistent across sessions.
 */

const PALETTE = [
  '#e74c3c', // red
  '#3498db', // blue
  '#2ecc71', // green
  '#f39c12', // orange
  '#9b59b6', // purple
  '#1abc9c', // teal
  '#e67e22', // dark orange
  '#e91e63', // pink
  '#00bcd4', // cyan
  '#8bc34a', // light green
  '#ff5722', // deep orange
  '#795548', // brown
  '#607d8b', // blue grey
  '#16a085', // dark teal
  '#d35400', // burnt orange
  '#8e44ad', // dark purple
];

/** Default color for unassigned markups. */
export const DEFAULT_MARKUP_COLOR = '#4a9eff';

/**
 * Return a palette color for a given task ID.
 * The same ID always maps to the same color (hash-based, order-independent).
 */
export function getTaskColor(taskId: string): string {
  let hash = 5381;
  for (let i = 0; i < taskId.length; i++) {
    hash = ((hash << 5) + hash + taskId.charCodeAt(i)) & 0xffff;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
