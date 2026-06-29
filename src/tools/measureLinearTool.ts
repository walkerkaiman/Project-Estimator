import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf, distance } from '../geometry/transform.ts';
import { formatLinear } from '../measure/units.ts';
import { generateId } from '../model/document.ts';
import type { MeasureLinearMarkup } from '../model/document.ts';

export class MeasureLinearTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewLine: Konva.Line | null = null;
  private previewLabel: Konva.Text | null = null;
  private previewLabelBg: Konva.Rect | null = null;

  constructor(ctx: ToolContext) {
    super('measure-linear', ctx);
  }

  private getLabel(kx1: number, ky1: number, kx2: number, ky2: number): string {
    const h = this.ctx.getPageHeightPts();
    const scale = this.ctx.getScale();
    if (!scale.calibrated) return 'Set scale first';
    const p1 = konvaToPdf(kx1, ky1, h);
    const p2 = konvaToPdf(kx2, ky2, h);
    const distPts = distance(p1, p2);
    return formatLinear(distPts, scale.pointsPerUnit, this.ctx.getUnits().linearUnit);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.mlin touchstart.mlin', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };

      this.previewLine = new Konva.Line({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
      });
      this.previewLabel = new Konva.Text({
        x: pos.x + 6, y: pos.y - 16,
        text: '', fontSize: 11, fontFamily: 'Arial', fill: '#0077cc', padding: 3,
      });
      this.previewLabelBg = new Konva.Rect({
        x: pos.x + 3, y: pos.y - 19,
        width: 0, height: 0,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      interactionLayer.add(this.previewLine, this.previewLabelBg, this.previewLabel);
    });

    stage.on('mousemove.mlin touchmove.mlin', () => {
      if (!this.isDrawing || !this.previewLine || !this.previewLabel) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      this.previewLine.points([this.startPos.x, this.startPos.y, pos.x, pos.y]);
      const label = this.getLabel(this.startPos.x, this.startPos.y, pos.x, pos.y);
      const midX = (this.startPos.x + pos.x) / 2;
      const midY = (this.startPos.y + pos.y) / 2;
      this.previewLabel.setAttrs({ x: midX + 6, y: midY - 16, text: label });
      this.previewLabelBg!.setAttrs({
        x: midX + 3, y: midY - 19,
        width: this.previewLabel.width() + 6,
        height: this.previewLabel.height() + 6,
      });
      interactionLayer.draw();
    });

    stage.on('mouseup.mlin touchend.mlin', () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (this.previewLine) { this.previewLine.destroy(); this.previewLine = null; }
      if (this.previewLabel) { this.previewLabel.destroy(); this.previewLabel = null; }
      if (this.previewLabelBg) { this.previewLabelBg.destroy(); this.previewLabelBg = null; }

      if (!pos) return;

      const h = this.ctx.getPageHeightPts();
      const p1 = konvaToPdf(this.startPos.x, this.startPos.y, h);
      const p2 = konvaToPdf(pos.x, pos.y, h);

      if (distance(p1, p2) < 4) return;

      const label = this.getLabel(this.startPos.x, this.startPos.y, pos.x, pos.y);
      const markup: MeasureLinearMarkup = {
        id: generateId(),
        type: 'measure-linear',
        pageIndex: this.ctx.getPageIndex(),
        style: { strokeColor: '#0077cc', strokeWidth: 1.5 },
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        label,
      };
      this.ctx.onMarkupAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.mlin touchstart.mlin');
    stage.off('mousemove.mlin touchmove.mlin');
    stage.off('mouseup.mlin touchend.mlin');
    stage.container().style.cursor = 'default';
    if (this.previewLine) { this.previewLine.destroy(); this.previewLine = null; }
    if (this.previewLabel) { this.previewLabel.destroy(); this.previewLabel = null; }
    if (this.previewLabelBg) { this.previewLabelBg.destroy(); this.previewLabelBg = null; }
    this.isDrawing = false;
  }
}
