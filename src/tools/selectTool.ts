import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { canvasState } from '../canvas-state/canvasState.ts';

export class SelectTool extends BaseTool {
  private transformer: Konva.Transformer | null = null;
  private selectionRect: Konva.Rect | null = null;
  private isSelecting = false;
  private selStart = { x: 0, y: 0 };

  constructor(ctx: ToolContext) {
    super('select', ctx);
  }

  activate(): void {
    const { stage, markupLayer, interactionLayer } = this.ctx.stageManager;

    this.transformer = new Konva.Transformer({
      nodes: [],
      padding: 4,
      rotateEnabled: false,
      anchorSize: 8,
      anchorStroke: '#0077cc',
      anchorFill: '#fff',
      borderStroke: '#0077cc',
      borderDash: [4, 2],
    });
    interactionLayer.add(this.transformer);

    this.selectionRect = new Konva.Rect({
      stroke: '#0077cc', strokeWidth: 1, dash: [4, 2],
      fill: 'rgba(0,119,204,0.08)', visible: false, listening: false,
    });
    interactionLayer.add(this.selectionRect);

    stage.on('mousedown.select touchstart.select', (e) => {
      let checkNode: Konva.Node | null = e.target;
      while (checkNode) {
        if (checkNode === this.transformer) return;
        checkNode = checkNode.getParent?.() ?? null;
      }

      let markupNode: Konva.Node | null = null;
      let walk: Konva.Node | null = e.target;
      while (walk && walk !== this.stage) {
        if (walk.hasName('markup')) { markupNode = walk; break; }
        walk = walk.getParent?.() ?? null;
      }

      if (markupNode) {
        this.transformer!.nodes([markupNode as Konva.Shape]);
        canvasState.setSelection(markupNode.id());
        interactionLayer.draw();
        e.cancelBubble = true;
        return;
      }

      this.transformer!.nodes([]);
      canvasState.setSelection(null);
      this.isSelecting = true;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (pos) this.selStart = { ...pos };
      this.selectionRect!.setAttrs({ x: pos?.x ?? 0, y: pos?.y ?? 0, width: 0, height: 0, visible: true });
      interactionLayer.draw();
    });

    stage.on('mousemove.select touchmove.select', () => {
      if (!this.isSelecting) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const sx = Math.min(pos.x, this.selStart.x);
      const sy = Math.min(pos.y, this.selStart.y);
      this.selectionRect!.setAttrs({ x: sx, y: sy, width: Math.abs(pos.x - this.selStart.x), height: Math.abs(pos.y - this.selStart.y) });
      interactionLayer.draw();
    });

    stage.on('mouseup.select touchend.select', () => {
      if (!this.isSelecting) return;
      this.isSelecting = false;
      this.selectionRect!.visible(false);
      interactionLayer.draw();

      const sw = this.selectionRect!.width();
      const sh = this.selectionRect!.height();
      if (sw < 4 && sh < 4) return;

      const selBox = { x: this.selectionRect!.x(), y: this.selectionRect!.y(), width: sw, height: sh };
      const selected = markupLayer.find('.markup').filter(node => {
        const nb = node.getClientRect({ relativeTo: markupLayer });
        return nb.x < selBox.x + selBox.width && nb.x + nb.width > selBox.x &&
               nb.y < selBox.y + selBox.height && nb.y + nb.height > selBox.y;
      });

      if (selected.length > 0) {
        this.transformer!.nodes(selected as Konva.Shape[]);
        if (selected.length === 1) canvasState.setSelection(selected[0].id());
        interactionLayer.draw();
      }
    });

    this.transformer.on('transformend dragend', () => {
      const nodes = this.transformer!.nodes();
      nodes.forEach(node => {
        canvasState.emit('markup-transform', { id: node.id(), node });
      });
    });

    markupLayer.find('.markup').forEach(n => (n as Konva.Shape).draggable(true));
  }

  deactivate(): void {
    const { stage, markupLayer } = this.ctx.stageManager;
    stage.off('mousedown.select touchstart.select');
    stage.off('mousemove.select touchmove.select');
    stage.off('mouseup.select touchend.select');

    if (this.transformer) { this.transformer.nodes([]); this.transformer.destroy(); this.transformer = null; }
    if (this.selectionRect) { this.selectionRect.destroy(); this.selectionRect = null; }

    markupLayer.find('.markup').forEach(n => (n as Konva.Shape).draggable(false));
    canvasState.setSelection(null);
  }

  refreshDraggable(): void {
    const { markupLayer } = this.ctx.stageManager;
    markupLayer.find('.markup').forEach(n => (n as Konva.Shape).draggable(true));
  }

  clearSelection(): void {
    if (this.transformer) this.transformer.nodes([]);
    canvasState.setSelection(null);
    this.ctx.stageManager.interactionLayer.draw();
  }
}
