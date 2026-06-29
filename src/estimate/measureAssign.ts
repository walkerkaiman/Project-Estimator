/**
 * Measurement Assignment
 *
 * Links a canvas measurement markup to a specific task scope input.
 * When a measurement is updated (length, area, count), the value flows
 * automatically into the matching scope entry for the assigned task.
 *
 * This module defines the data contract and assignment store.
 * The canvas integration (porting measurement tools from RedlinePDF) is
 * done in a later milestone; this module is consumed by that integration.
 *
 * ── Data shape ─────────────────────────────────────────────────────────────
 *
 * Each "assignment" ties:
 *   markupId → taskId + role (e.g. 'length', 'area', 'count')
 *
 * When the measurement markup is moved or redrawn, the engine recomputes the
 * numeric value and calls `applyMeasurement(markupId, value)`.
 */

import { appState } from '../appState.ts';
import type { MeasurementAssignment } from './project.ts';

export type { MeasurementAssignment };

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getAssignments(): MeasurementAssignment[] {
  return appState.project.measureAssignments;
}

function setAssignments(assignments: MeasurementAssignment[]): void {
  appState.project.measureAssignments = assignments;
  appState.dirty = true;
}

export function getAssignmentForMarkup(markupId: string): MeasurementAssignment | undefined {
  return getAssignments().find(a => a.markupId === markupId);
}

export function getAssignmentsForTask(taskId: string): MeasurementAssignment[] {
  return getAssignments().filter(a => a.taskId === taskId);
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export function assignMarkup(assignment: MeasurementAssignment): void {
  const existing = getAssignments().filter(a => a.markupId !== assignment.markupId);
  setAssignments([...existing, assignment]);
}

export function unassignMarkup(markupId: string): void {
  setAssignments(getAssignments().filter(a => a.markupId !== markupId));
}

// ── Value propagation ─────────────────────────────────────────────────────────

/**
 * Called by the canvas layer whenever a measurement markup's value changes.
 * Updates the corresponding scope entry so formulas recompute automatically.
 *
 * @param markupId  The canvas markup that changed.
 * @param value     The new computed measurement value (feet, sq ft, count, etc.).
 */
export function applyMeasurement(markupId: string, value: number): void {
  const assignment = getAssignmentForMarkup(markupId);
  if (!assignment) return;

  const scope = appState.project.scope;
  const idx = scope.findIndex(s => s.taskId === assignment.taskId && s.role === assignment.role);
  if (idx >= 0) {
    scope[idx].value = value;
  } else {
    scope.push({ taskId: assignment.taskId, role: assignment.role, value, markupId });
  }

  appState.dirty = true;
  appState.emit('scope-changed');
}
