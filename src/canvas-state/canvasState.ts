/**
 * Canvas-specific state for the PDF measurement panel.
 *
 * Deliberately separate from appState.ts (the estimate state) so the two
 * domains don't bleed into each other.
 */

import type { MarkupType, UnitsSettings } from '../model/document.ts';
import { DEFAULT_STROKE_STYLE, DEFAULT_UNITS } from '../model/document.ts';

export type CanvasToolType =
  | 'select' | 'pan'
  | 'scale-set'
  | 'measure-linear' | 'measure-rect' | 'measure-poly'
  | 'count';

type StateListener = (s: Readonly<CanvasState>) => void;
type EventListener = (data: unknown) => void;

export interface CanvasState {
  activeTool: CanvasToolType;
  zoom: number;
  units: UnitsSettings;
  selectedMarkupId: string | null;
  selectedMarkupType: MarkupType | null;
  hasPdf: boolean;
}

class CanvasStateManager {
  private _state: CanvasState = {
    activeTool: 'select',
    zoom: 1,
    units: { ...DEFAULT_UNITS },
    selectedMarkupId: null,
    selectedMarkupType: null,
    hasPdf: false,
  };

  private listeners: StateListener[] = [];
  private eventListeners: Map<string, EventListener[]> = new Map();

  get state(): Readonly<CanvasState> { return this._state; }

  update(partial: Partial<CanvasState>): void {
    this._state = { ...this._state, ...partial };
    this.listeners.forEach(fn => fn(this._state));
  }

  subscribe(fn: StateListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  on(event: string, fn: EventListener): () => void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event)!.push(fn);
    return () => {
      const arr = this.eventListeners.get(event) ?? [];
      this.eventListeners.set(event, arr.filter(l => l !== fn));
    };
  }

  emit(event: string, data?: unknown): void {
    (this.eventListeners.get(event) ?? []).forEach(fn => fn(data));
  }

  setTool(tool: CanvasToolType): void {
    this.update({ activeTool: tool, selectedMarkupId: null, selectedMarkupType: null });
    this.emit('tool-change', tool);
  }

  setZoom(zoom: number): void {
    const z = Math.max(0.1, Math.min(10, zoom));
    this.update({ zoom: z });
    this.emit('zoom-change', z);
  }

  setSelection(id: string | null, type: MarkupType | null = null): void {
    this.update({ selectedMarkupId: id, selectedMarkupType: type });
    this.emit('selection-change', id);
  }
}

export const canvasState = new CanvasStateManager();

// Re-export DEFAULT_STROKE_STYLE so tools can import from here
export { DEFAULT_STROKE_STYLE };
