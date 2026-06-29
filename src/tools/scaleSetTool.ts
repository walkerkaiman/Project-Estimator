import Konva from 'konva';
import { BaseTool, type ToolContext } from './baseTool.ts';
import { konvaToPdf } from '../geometry/transform.ts';
import { computeScale } from '../measure/scale.ts';
import { distance } from '../geometry/transform.ts';
import { canvasState } from '../canvas-state/canvasState.ts';

type Phase = 'idle' | 'awaiting-second-point' | 'awaiting-input';

export class ScaleSetTool extends BaseTool {
  private phase: Phase = 'idle';
  private point1: { x: number; y: number } | null = null;
  private previewLine: Konva.Line | null = null;
  private dot1: Konva.Circle | null = null;
  private dot2: Konva.Circle | null = null;

  constructor(ctx: ToolContext) {
    super('scale-set', ctx);
  }

  activate(): void {
    const { stage, interactionLayer } = this.ctx.stageManager;
    stage.container().style.cursor = 'crosshair';

    stage.on('mousedown.scaleset touchstart.scaleset', async () => {
      if (this.phase === 'awaiting-input') return;

      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;

      if (this.phase === 'idle') {
        this.point1 = { ...pos };
        this.phase = 'awaiting-second-point';

        this.dot1 = new Konva.Circle({ x: pos.x, y: pos.y, radius: 5, fill: '#ff9900', stroke: '#fff', strokeWidth: 1 });
        this.previewLine = new Konva.Line({
          points: [pos.x, pos.y, pos.x, pos.y],
          stroke: '#ff9900', strokeWidth: 2, dash: [6, 4],
        });
        interactionLayer.add(this.dot1, this.previewLine);

      } else if (this.phase === 'awaiting-second-point' && this.point1) {
        this.phase = 'awaiting-input';

        this.dot2 = new Konva.Circle({ x: pos.x, y: pos.y, radius: 5, fill: '#ff9900', stroke: '#fff', strokeWidth: 1 });
        interactionLayer.add(this.dot2);
        if (this.previewLine) {
          this.previewLine.points([this.point1.x, this.point1.y, pos.x, pos.y]);
        }
        interactionLayer.draw();

        const h = this.ctx.getPageHeightPts();
        const pdfP1 = konvaToPdf(this.point1.x, this.point1.y, h);
        const pdfP2 = konvaToPdf(pos.x, pos.y, h);
        const distPts = distance(pdfP1, pdfP2);

        await this.showCalibrationDialog(distPts);
        this.clearPreview();
        this.phase = 'idle';
      }
    });

    stage.on('mousemove.scaleset touchmove.scaleset', () => {
      if (this.phase !== 'awaiting-second-point' || !this.point1 || !this.previewLine) return;
      const pos = this.ctx.stageManager.getLayerPointer();
      if (!pos) return;
      this.previewLine.points([this.point1.x, this.point1.y, pos.x, pos.y]);
      interactionLayer.draw();
    });
  }

  private clearPreview(): void {
    if (this.previewLine) { this.previewLine.destroy(); this.previewLine = null; }
    if (this.dot1) { this.dot1.destroy(); this.dot1 = null; }
    if (this.dot2) { this.dot2.destroy(); this.dot2 = null; }
    this.point1 = null;
    this.ctx.stageManager.interactionLayer.draw();
  }

  private async showCalibrationDialog(distancePts: number): Promise<void> {
    const units = this.ctx.getUnits();
    const unitOptions = [
      { value: 'ft', label: 'Feet (ft)' },
      { value: 'in', label: 'Inches (in)' },
      { value: 'ft-in', label: 'Feet (decimal, e.g. 10.5 = 10\'-6")' },
      { value: 'yd', label: 'Yards (yd)' },
      { value: 'm', label: 'Meters (m)' },
      { value: 'cm', label: 'Centimeters (cm)' },
      { value: 'mm', label: 'Millimeters (mm)' },
    ];

    const currentUnit = units.linearUnit === 'ft-in' ? 'ft' : units.linearUnit;
    const optionsHtml = unitOptions
      .map(o => `<option value="${o.value}"${o.value === currentUnit ? ' selected' : ''}>${o.label}</option>`)
      .join('');

    const body = `
      <p>Enter the real-world length of the distance you just measured.</p>
      <div class="form-row">
        <label>Known distance:</label>
        <input type="number" id="scale-value" min="0.001" step="any" placeholder="e.g. 10" style="width:100px;" />
        <select id="scale-unit">${optionsHtml}</select>
      </div>
      <p class="modal-hint">Tip: pick two points on a known dimension (e.g. a 10-foot wall).</p>
    `;

    const result = await this.ctx.showModal('Set Drawing Scale', body, 'Apply Scale');
    if (!result) return;

    const valEl = document.getElementById('scale-value') as HTMLInputElement;
    const unitEl = document.getElementById('scale-unit') as HTMLSelectElement;
    const value = parseFloat(valEl?.value ?? '');
    const unit = (unitEl?.value ?? 'ft') as import('../model/document.ts').LinearUnit;

    if (isNaN(value) || value <= 0) return;

    const scale = computeScale(distancePts, value, unit);
    if (scale.calibrated) {
      canvasState.emit('scale-set', { pageIndex: this.ctx.getPageIndex(), scale });
    }
  }

  deactivate(): void {
    const { stage } = this.ctx.stageManager;
    stage.off('mousedown.scaleset touchstart.scaleset');
    stage.off('mousemove.scaleset touchmove.scaleset');
    stage.container().style.cursor = 'default';
    this.clearPreview();
    this.phase = 'idle';
  }
}
