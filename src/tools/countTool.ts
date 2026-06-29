import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { generateId } from '../model/document.ts';
import type { CountMarkup } from '../model/document.ts';

export class CountTool extends BaseTool {
  constructor(ctx: ToolContext) {
    super('count', ctx);
  }

  activate(): void {
    const { stage } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.count touchstart.count', (e) => {
      // Ignore clicks on existing markups or transformer handles
      let check = e.target as import('konva').default.Node | null;
      while (check) {
        if (check.getClassName() === 'Transformer') return;
        check = check.getParent?.() ?? null;
      }
      const target = e.target;
      const isMarkup = target.hasName('markup') || (target.parent?.hasName('markup') ?? false);
      if (isMarkup) return;

      const category = this.ctx.getActiveCountCategory();
      if (!category) return;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      const h = this.ctx.getPageHeightPts();
      const pdfPos = konvaToPdf(pos.x, pos.y, h);

      const markup: CountMarkup = {
        id: generateId(),
        type: 'count',
        pageIndex: this.ctx.getPageIndex(),
        style: { strokeColor: category.color, strokeWidth: 1.5, strokeOpacity: 1 },
        x: pdfPos.x,
        y: pdfPos.y,
        categoryId: category.id,
        symbol: category.symbol,
        color: category.color,
        size: this.ctx.getCountSymbolSize(),
      };

      this.ctx.onCountAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.count touchstart.count');
    stage.container().style.cursor = 'default';
  }
}
