import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { canvasState } from '../canvas-state/canvasState.ts';

export class SelectTool extends BaseTool {
  private transformer: Konva.Transformer | null = null;
  private selectionRect: Konva.Rect | null = null;
  private selectionRing: Konva.Circle | null = null; // highlight for count markers
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

    // Ring shown around selected count markers (no transformer for point shapes)
    this.selectionRing = new Konva.Circle({
      radius: 14, stroke: '#fff', strokeWidth: 2,
      dash: [4, 3], fill: 'transparent',
      visible: false, listening: false,
    });
    interactionLayer.add(this.selectionRing);

    stage.on('mousedown.select touchstart.select', (e) => {
      // Ignore clicks that originate on the transformer itself
      let checkNode: Konva.Node | null = e.target;
      while (checkNode) {
        if (checkNode === this.transformer) return;
        checkNode = checkNode.getParent?.() ?? null;
      }

      // Walk up the node tree to find the topmost node named 'markup'
      let markupNode: Konva.Node | null = null;
      let walk: Konva.Node | null = e.target;
      while (walk && walk !== this.stage) {
        if (walk.hasName('markup')) { markupNode = walk; break; }
        walk = walk.getParent?.() ?? null;
      }

      if (markupNode) {
        this.selectNode(markupNode);
        e.cancelBubble = true;
        return;
      }

      // Clicked empty space — clear selection and start rubber-band
      this.clearSelection();
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
      this.selectionRect!.setAttrs({
        x: sx, y: sy,
        width: Math.abs(pos.x - this.selStart.x),
        height: Math.abs(pos.y - this.selStart.y),
      });
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

      const selBox = {
        x: this.selectionRect!.x(), y: this.selectionRect!.y(), width: sw, height: sh,
      };
      const selected = markupLayer.find('.markup').filter(node => {
        const nb = node.getClientRect({ relativeTo: markupLayer });
        return nb.x < selBox.x + selBox.width && nb.x + nb.width > selBox.x &&
               nb.y < selBox.y + selBox.height && nb.y + nb.height > selBox.y;
      });

      if (selected.length === 1) {
        this.selectNode(selected[0]);
      } else if (selected.length > 1) {
        // Multi-select: show transformer on all (non-count) nodes
        const nonCount = selected.filter(n => n.getAttr('markupType') !== 'count');
        this.transformer!.nodes(nonCount as Konva.Shape[]);
        canvasState.setSelection(selected[0].id()); // select first for keyboard delete
        this.selectionRing!.visible(false);
        interactionLayer.draw();
      }
    });

    this.transformer.on('transformend dragend', () => {
      this.transformer!.nodes().forEach(node => {
        canvasState.emit('markup-transform', { id: node.id(), node });
      });
    });

    this.refreshDraggable();
  }

  /** Select a single node, adapting the UI to its type. */
  private selectNode(node: Konva.Node): void {
    const { interactionLayer } = this.ctx.stageManager;
    const markupType = node.getAttr('markupType') as string | undefined;
    canvasState.setSelection(node.id());

    if (markupType === 'count') {
      // Count markers: show a ring instead of resize handles
      this.transformer!.nodes([]);
      const absPos = node.getAbsolutePosition();
      this.selectionRing!.setAttrs({
        x: absPos.x, y: absPos.y,
        visible: true,
        stroke: '#fff',
      });
    } else {
      // Measurement: show full transformer
      this.selectionRing!.visible(false);
      this.transformer!.nodes([node as Konva.Shape]);
    }
    interactionLayer.draw();
  }

  deactivate(): void {
    const { stage, markupLayer } = this.ctx.stageManager;
    stage.off('mousedown.select touchstart.select');
    stage.off('mousemove.select touchmove.select');
    stage.off('mouseup.select touchend.select');

    if (this.transformer) { this.transformer.nodes([]); this.transformer.destroy(); this.transformer = null; }
    if (this.selectionRect) { this.selectionRect.destroy(); this.selectionRect = null; }
    if (this.selectionRing) { this.selectionRing.destroy(); this.selectionRing = null; }

    markupLayer.find('.markup').forEach(n => (n as Konva.Shape).draggable(false));
    canvasState.setSelection(null);
  }

  /** Make all current markup nodes draggable. Call after adding a new markup. */
  refreshDraggable(): void {
    const { markupLayer } = this.ctx.stageManager;
    markupLayer.find('.markup').forEach(n => (n as Konva.Shape).draggable(true));
  }

  clearSelection(): void {
    if (this.transformer) this.transformer.nodes([]);
    if (this.selectionRing) this.selectionRing.visible(false);
    canvasState.setSelection(null);
    this.ctx.stageManager.interactionLayer.draw();
  }
}
