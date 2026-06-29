import type Konva from 'konva';
import type { KonvaStageManager } from '../canvas/stage.ts';
import type { CanvasToolType } from '../canvas-state/canvasState.ts';

export interface ToolContext {
  stageManager: KonvaStageManager;
  onMarkupAdd: (markup: import('../model/document.ts').Markup) => void;
  onMarkupUpdate: (id: string, partial: Partial<import('../model/document.ts').Markup>) => void;
  getStyle: () => import('../model/document.ts').MarkupStyle;
  getPageHeightPts: () => number;
  getPageIndex: () => number;
  getScale: () => import('../model/document.ts').PageScale;
  getUnits: () => import('../model/document.ts').UnitsSettings;
  showModal: (title: string, body: string, okText?: string) => Promise<string | null>;
}

export abstract class BaseTool {
  readonly type: CanvasToolType;
  protected ctx: ToolContext;
  protected stage: Konva.Stage;

  constructor(type: CanvasToolType, ctx: ToolContext) {
    this.type = type;
    this.ctx = ctx;
    this.stage = ctx.stageManager.stage;
  }

  abstract activate(): void;
  abstract deactivate(): void;
}
