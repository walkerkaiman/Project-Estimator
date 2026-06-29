import { BaseTool, type ToolContext } from './baseTool.ts';

export class PanTool extends BaseTool {
  private isDragging = false;
  private lastPos = { x: 0, y: 0 };

  constructor(ctx: ToolContext) {
    super('pan', ctx);
  }

  activate(): void {
    const { stage } = this.ctx.stageManager;
    stage.container().style.cursor = 'grab';

    stage.on('mousedown.pan touchstart.pan', (e) => {
      this.isDragging = true;
      const pos = stage.getPointerPosition();
      if (pos) this.lastPos = pos;
      stage.container().style.cursor = 'grabbing';
      e.evt.preventDefault();
    });

    stage.on('mousemove.pan touchmove.pan', (e) => {
      if (!this.isDragging) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const dx = pos.x - this.lastPos.x;
      const dy = pos.y - this.lastPos.y;
      stage.position({ x: stage.x() + dx, y: stage.y() + dy });
      stage.draw();
      this.lastPos = pos;
      e.evt.preventDefault();
    });

    stage.on('mouseup.pan touchend.pan', () => {
      this.isDragging = false;
      stage.container().style.cursor = 'grab';
    });

    stage.on('mouseleave.pan', () => {
      this.isDragging = false;
      stage.container().style.cursor = 'grab';
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.pan touchstart.pan');
    stage.off('mousemove.pan touchmove.pan');
    stage.off('mouseup.pan touchend.pan');
    stage.off('mouseleave.pan');
    stage.container().style.cursor = 'default';
    this.isDragging = false;
  }
}
