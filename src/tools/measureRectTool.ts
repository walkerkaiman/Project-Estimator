import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaRectToPdf } from '../geometry/transform.ts';
import { formatLinear, formatArea } from '../measure/units.ts';
import { generateId } from '../model/document.ts';
import type { MeasureRectMarkup } from '../model/document.ts';

export class MeasureRectTool extends BaseTool {
  private isDrawing = false;
  private startPos = { x: 0, y: 0 };
  private previewRect: Konva.Rect | null = null;
  private previewLabel: Konva.Text | null = null;
  private previewLabelBg: Konva.Rect | null = null;

  constructor(ctx: ToolContext) {
    super('measure-rect', ctx);
  }

  private buildLabel(_kx: number, _ky: number, kw: number, kh: number): string {
    const scale = this.ctx.getScale();
    if (!scale.calibrated) return 'Set scale first';
    const unit = this.ctx.getUnits().linearUnit;
    const ppi = scale.pointsPerUnit;
    const widthLabel = formatLinear(kw, ppi, unit);
    const heightLabel = formatLinear(kh, ppi, unit);
    const areaLabel = formatArea(kw * kh, ppi, unit);
    return `W: ${widthLabel}\nH: ${heightLabel}\n${areaLabel}`;
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.mrect touchstart.mrect', () => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.isDrawing = true;
      this.startPos = { ...pos };

      this.previewRect = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
        fill: 'rgba(0,119,204,0.08)',
      });
      this.previewLabel = new Konva.Text({
        x: pos.x, y: pos.y,
        text: '', fontSize: 11, fontFamily: 'Arial', fill: '#0077cc', padding: 3,
        align: 'center',
      });
      this.previewLabelBg = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      interactionLayer.add(this.previewRect, this.previewLabelBg, this.previewLabel);
    });

    stage.on('mousemove.mrect touchmove.mrect', () => {
      if (!this.isDrawing || !this.previewRect || !this.previewLabel) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      const x = Math.min(pos.x, this.startPos.x);
      const y = Math.min(pos.y, this.startPos.y);
      const w = Math.abs(pos.x - this.startPos.x);
      const h = Math.abs(pos.y - this.startPos.y);

      this.previewRect.setAttrs({ x, y, width: w, height: h });

      const label = this.buildLabel(x, y, w, h);
      const cx = x + w / 2;
      const cy = y + h / 2;
      this.previewLabel.setAttrs({ text: label, x: cx - 40, y: cy - 20, width: 80 });
      this.previewLabelBg!.setAttrs({ x: cx - 43, y: cy - 23, width: 86, height: this.previewLabel.height() + 6 });
      interactionLayer.draw();
    });

    stage.on('mouseup.mrect touchend.mrect', () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (this.previewRect) { this.previewRect.destroy(); this.previewRect = null; }
      if (this.previewLabel) { this.previewLabel.destroy(); this.previewLabel = null; }
      if (this.previewLabelBg) { this.previewLabelBg.destroy(); this.previewLabelBg = null; }

      if (!pos) return;

      const kx = Math.min(pos.x, this.startPos.x);
      const ky = Math.min(pos.y, this.startPos.y);
      const kw = Math.abs(pos.x - this.startPos.x);
      const kh = Math.abs(pos.y - this.startPos.y);

      if (kw < 4 || kh < 4) return;

      const pdfRect = konvaRectToPdf(kx, ky, kw, kh, this.ctx.getPageHeightPts());
      const label = this.buildLabel(kx, ky, kw, kh);

      const markup: MeasureRectMarkup = {
        id: generateId(),
        type: 'measure-rect',
        pageIndex: this.ctx.getPageIndex(),
        style: { strokeColor: '#0077cc', strokeWidth: 1.5 },
        ...pdfRect,
        label,
      };
      this.ctx.onMarkupAdd(markup);
    });
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.mrect touchstart.mrect');
    stage.off('mousemove.mrect touchmove.mrect');
    stage.off('mouseup.mrect touchend.mrect');
    stage.container().style.cursor = 'default';
    if (this.previewRect) { this.previewRect.destroy(); this.previewRect = null; }
    if (this.previewLabel) { this.previewLabel.destroy(); this.previewLabel = null; }
    if (this.previewLabelBg) { this.previewLabelBg.destroy(); this.previewLabelBg = null; }
    this.isDrawing = false;
  }
}
