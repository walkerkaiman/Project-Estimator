import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf, polygonArea, polygonPerimeter, distance } from '../geometry/transform.ts';
import { formatLinear, formatArea } from '../measure/units.ts';
import { generateId } from '../model/document.ts';
import type { MeasurePolyMarkup, Point } from '../model/document.ts';

export class MeasurePolyTool extends BaseTool {
  private vertices: Point[] = []; // Konva space
  private lines: Konva.Line[] = [];
  private dots: Konva.Circle[] = [];
  private closingLine: Konva.Line | null = null;
  private labelNode: Konva.Text | null = null;
  private labelBg: Konva.Rect | null = null;
  private instructions: Konva.Text | null = null;

  constructor(ctx: ToolContext) {
    super('measure-poly', ctx);
  }

  private buildLabel(): string {
    const scale = this.ctx.getScale();
    if (!scale.calibrated || this.vertices.length < 3) return '';
    const unit = this.ctx.getUnits().linearUnit;
    const ppi = scale.pointsPerUnit;

    // Convert vertices to PDF space for area calc
    const h = this.ctx.getPageHeightPts();
    const pdfPts = this.vertices.map(v => konvaToPdf(v.x, v.y, h));

    const area = polygonArea(pdfPts);
    const perimeter = polygonPerimeter(pdfPts);

    return `Area: ${formatArea(area, ppi, unit)}\n\nPerim: ${formatLinear(perimeter, ppi, unit)}`;
  }

  private updatePreview(): void {
    const { interactionLayer } = this.ctx.stageManager;

    // Update closing line to cursor
    if (this.vertices.length >= 2 && this.closingLine) {
      const first = this.vertices[0];
      const last = this.vertices[this.vertices.length - 1];
      this.closingLine.points([last.x, last.y, first.x, first.y]);
    }

    // Update area label
    const label = this.buildLabel();
    if (label && this.vertices.length >= 3) {
      const cx = this.vertices.reduce((s, v) => s + v.x, 0) / this.vertices.length;
      const cy = this.vertices.reduce((s, v) => s + v.y, 0) / this.vertices.length;
      if (this.labelNode) {
        this.labelNode.setAttrs({ x: cx - 75, y: cy - 12, text: label, visible: true });
        this.labelBg?.setAttrs({ x: cx - 78, y: cy - 15, width: 156, height: this.labelNode.height() + 6, visible: true });
      }
    } else if (this.labelNode) {
      this.labelNode.visible(false);
      this.labelBg?.visible(false);
    }

    interactionLayer.draw();
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    // Instructions text
    this.instructions = new Konva.Text({
      x: 10, y: 10,
      text: 'Click to place vertices · Double-click or Enter to close polygon · Esc to cancel',
      fontSize: 11, fontFamily: 'Arial', fill: '#0077cc',
      padding: 4,
    });
    const instrBg = new Konva.Rect({
      x: 7, y: 7,
      width: this.instructions.width() + 8,
      height: this.instructions.height() + 8,
      fill: 'rgba(255,255,255,0.9)', cornerRadius: 4,
    });
    interactionLayer.add(instrBg, this.instructions);

    // Pre-create label
    this.labelNode = new Konva.Text({
      x: 0, y: 0, text: '', fontSize: 11, fontFamily: 'Arial',
      fill: '#0077cc', visible: false, width: 150, align: 'center',
    });
    this.labelBg = new Konva.Rect({
      x: 0, y: 0, width: 156, height: 0,
      fill: 'rgba(255,255,255,0.85)', cornerRadius: 2, visible: false,
    });
    interactionLayer.add(this.labelBg, this.labelNode);

    stage.on('click.mpoly tap.mpoly', (e) => {
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      // Double-click closes the polygon
      if (e.evt.type === 'dblclick' || (e.evt as MouseEvent).detail === 2) {
        this.finalizePoly();
        return;
      }

      // If clicking near first vertex (within 10px), close
      if (this.vertices.length >= 3) {
        const first = this.vertices[0];
        const d = distance(pos, first);
        const scale = this.ctx.stageManager.stage.scaleX();
        if (d * scale < 12) {
          this.finalizePoly();
          return;
        }
      }

      // Add vertex
      this.addVertex(pos);
    });

    stage.on('mousemove.mpoly touchmove.mpoly', () => {
      if (this.vertices.length === 0 || !this.closingLine) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      const last = this.vertices[this.vertices.length - 1];
      this.closingLine.points([last.x, last.y, pos.x, pos.y]);
      interactionLayer.draw();
    });

    // Keyboard shortcuts
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); this.finalizePoly(); }
      if (e.key === 'Escape') { e.preventDefault(); this.clearPreview(); }
    };
    window.addEventListener('keydown', this._onKeyDown);

    interactionLayer.draw();
  }

  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  private addVertex(pos: Point): void {
    const { interactionLayer } = this.ctx.stageManager;
    this.vertices.push({ ...pos });

    const dot = new Konva.Circle({ x: pos.x, y: pos.y, radius: 5, fill: '#0077cc', stroke: '#fff', strokeWidth: 1 });
    this.dots.push(dot);
    interactionLayer.add(dot);

    if (this.vertices.length >= 2) {
      const prev = this.vertices[this.vertices.length - 2];
      const line = new Konva.Line({
        points: [prev.x, prev.y, pos.x, pos.y],
        stroke: '#0077cc', strokeWidth: 1.5, dash: [6, 3],
      });
      this.lines.push(line);
      interactionLayer.add(line);
    }

    // Create/update the dynamic cursor-tracking line
    if (this.closingLine) this.closingLine.destroy();
    this.closingLine = new Konva.Line({
      points: [pos.x, pos.y, pos.x, pos.y],
      stroke: '#0077cc', strokeWidth: 1.5, dash: [4, 4], opacity: 0.6,
    });
    interactionLayer.add(this.closingLine);

    this.updatePreview();
  }

  private finalizePoly(): void {
    if (this.vertices.length < 3) { this.clearPreview(); return; }

    const h = this.ctx.getPageHeightPts();
    const scale = this.ctx.getScale();
    const unit = this.ctx.getUnits().linearUnit;
    const pdfPts = this.vertices.map(v => konvaToPdf(v.x, v.y, h));
    const area = polygonArea(pdfPts);
    const perimeter = polygonPerimeter(pdfPts);

    let label: string;
    if (scale.calibrated) {
      const ppi = scale.pointsPerUnit;
      label = `Area: ${formatArea(area, ppi, unit)}\n\nPerim: ${formatLinear(perimeter, ppi, unit)}`;
    } else {
      label = `${pdfPts.length} vertices\n(Set scale to measure)`;
    }

    const markup: MeasurePolyMarkup = {
      id: generateId(),
      type: 'measure-poly',
      pageIndex: this.ctx.getPageIndex(),
      style: { strokeColor: '#0077cc', strokeWidth: 1.5 },
      points: pdfPts,
      label,
    };

    this.clearPreview();
    this.ctx.onMarkupAdd(markup);
  }

  private clearPreview(): void {
    this.vertices = [];
    this.lines.forEach(l => l.destroy());
    this.lines = [];
    this.dots.forEach(d => d.destroy());
    this.dots = [];
    if (this.closingLine) { this.closingLine.destroy(); this.closingLine = null; }
    if (this.labelNode) { this.labelNode.destroy(); this.labelNode = null; }
    if (this.labelBg) { this.labelBg.destroy(); this.labelBg = null; }
    if (this.instructions) { this.instructions.destroy(); this.instructions = null; }
    const instrBg = this.ctx.stageManager.interactionLayer.findOne('Rect');
    if (instrBg) instrBg.destroy();
    this.ctx.stageManager.interactionLayer.draw();
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('click.mpoly tap.mpoly');
    stage.off('mousemove.mpoly touchmove.mpoly');
    stage.container().style.cursor = 'default';
    if (this._onKeyDown) { window.removeEventListener('keydown', this._onKeyDown); this._onKeyDown = null; }
    this.clearPreview();
  }
}
