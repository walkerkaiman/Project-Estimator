/**
 * Konva stage manager for the PDF measurement canvas.
 *
 * Handles only measurement markup types (measure-linear, measure-rect,
 * measure-poly). The full RedlinePDF annotation types are intentionally
 * omitted here; they can be added back in a later milestone.
 */

import Konva from 'konva';
import type {
  Markup, MeasureLinearMarkup, MeasureRectMarkup, MeasurePolyMarkup,
  CountMarkup, CountSymbol, Point,
} from '../model/document.ts';
import {
  pdfToKonva, pdfPointsToKonva, pdfRectToKonva,
  konvaToPdf, konvaPointsToPdf, konvaRectToPdf,
} from '../geometry/transform.ts';

export interface KonvaStageManager {
  stage: Konva.Stage;
  bgLayer: Konva.Layer;
  markupLayer: Konva.Layer;
  interactionLayer: Konva.Layer;
  pageHeightPts: number;
  pageWidthPts: number;

  setPdfImage(canvas: HTMLCanvasElement, widthPts: number, heightPts: number): void;
  updatePdfCanvas(canvas: HTMLCanvasElement): void;
  resize(widthPx: number, heightPx: number): void;
  setZoom(zoom: number): void;
  addMarkupNode(markup: Markup): Konva.Node;
  removeMarkupNode(id: string): void;
  findNode(id: string): Konva.Node | undefined;
  updateMarkupNode(markup: Markup): void;
  bakeTransform(markup: Markup): void;
  clearMarkups(): void;
  getLayerPointer(): Point | null;
  draw(): void;
}

/** Draw a count symbol shape centred at (0, 0) within a Konva.Group. */
function createCountSymbolShape(symbol: CountSymbol, color: string, size: number): Konva.Shape {
  switch (symbol) {
    case 'square':
      return new Konva.Rect({ x: -size / 2, y: -size / 2, width: size, height: size, fill: color, stroke: '#fff', strokeWidth: 1 });
    case 'triangle': {
      const h = size * Math.sqrt(3) / 2;
      return new Konva.Line({ points: [0, -h * 2 / 3, size / 2, h / 3, -size / 2, h / 3], closed: true, fill: color, stroke: '#fff', strokeWidth: 1 });
    }
    case 'diamond':
      return new Konva.Line({ points: [0, -size / 2, size / 2, 0, 0, size / 2, -size / 2, 0], closed: true, fill: color, stroke: '#fff', strokeWidth: 1 });
    case 'cross':
      return new Konva.Line({ points: [-size / 2, 0, size / 2, 0, NaN, NaN, 0, -size / 2, 0, size / 2], stroke: color, strokeWidth: size / 4 });
    case 'circle':
    default:
      return new Konva.Circle({ radius: size / 2, fill: color, stroke: '#fff', strokeWidth: 1 });
  }
}

export function hexWithOpacity(hex: string, opacity: number): string {
  if (opacity >= 1) return hex;
  if (opacity <= 0) return 'transparent';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function createMarkupNode(markup: Markup, pageHeightPts: number): Konva.Node {
  const style = markup.style;
  const mColor = style.strokeColor ?? '#0077cc';
  const mWidth = style.strokeWidth ?? 1.5;

  let node: Konva.Node;

  switch (markup.type) {
    case 'measure-linear': {
      const m = markup as MeasureLinearMarkup;
      const p1 = pdfToKonva(m.x1, m.y1, pageHeightPts);
      const p2 = pdfToKonva(m.x2, m.y2, pageHeightPts);
      const group = new Konva.Group({ name: 'markup', id: markup.id });

      const line = new Konva.Line({ points: [p1.x, p1.y, p2.x, p2.y], stroke: mColor, strokeWidth: mWidth, dash: [6, 3], hitStrokeWidth: 12 });
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perp = angle + Math.PI / 2;
      const tk = 6;
      const ticks = new Konva.Line({
        points: [
          p1.x + tk * Math.cos(perp), p1.y + tk * Math.sin(perp),
          p1.x - tk * Math.cos(perp), p1.y - tk * Math.sin(perp),
          NaN, NaN,
          p2.x + tk * Math.cos(perp), p2.y + tk * Math.sin(perp),
          p2.x - tk * Math.cos(perp), p2.y - tk * Math.sin(perp),
        ],
        stroke: mColor, strokeWidth: mWidth, hitStrokeWidth: 12,
      });
      const label = new Konva.Text({
        x: (p1.x + p2.x) / 2 + 6, y: (p1.y + p2.y) / 2 - 16,
        text: m.label, fontSize: 11, fontFamily: 'Arial', fill: mColor, padding: 3,
      });
      const labelBg = new Konva.Rect({
        x: (p1.x + p2.x) / 2 + 3, y: (p1.y + p2.y) / 2 - 19,
        width: label.width() + 6, height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      group.add(line, ticks, labelBg, label);
      node = group;
      break;
    }

    case 'measure-rect': {
      const m = markup as MeasureRectMarkup;
      const r = pdfRectToKonva(m.x, m.y, m.width, m.height, pageHeightPts);
      const group = new Konva.Group({ name: 'markup', id: markup.id });

      const rect = new Konva.Rect({ ...r, stroke: mColor, strokeWidth: mWidth, dash: [6, 3], fill: hexWithOpacity(mColor, 0.08), hitStrokeWidth: 12 });
      const label = new Konva.Text({
        x: r.x + r.width / 2 - 40, y: r.y + r.height / 2 - 10,
        text: m.label, fontSize: 11, fontFamily: 'Arial', fill: mColor,
        align: 'center', width: 80,
      });
      const labelBg = new Konva.Rect({
        x: r.x + r.width / 2 - 43, y: r.y + r.height / 2 - 13,
        width: 86, height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      group.add(rect, labelBg, label);
      node = group;
      break;
    }

    case 'measure-poly': {
      const m = markup as MeasurePolyMarkup;
      const konvaPoints = m.points.flatMap(p => {
        const k = pdfToKonva(p.x, p.y, pageHeightPts);
        return [k.x, k.y];
      });
      const group = new Konva.Group({ name: 'markup', id: markup.id });

      const poly = new Konva.Line({
        points: konvaPoints, closed: true,
        stroke: mColor, strokeWidth: mWidth, dash: [6, 3],
        fill: hexWithOpacity(mColor, 0.08), hitStrokeWidth: 12,
      });

      const cx = konvaPoints.filter((_, i) => i % 2 === 0).reduce((s, v) => s + v, 0) / (konvaPoints.length / 2);
      const cy = konvaPoints.filter((_, i) => i % 2 === 1).reduce((s, v) => s + v, 0) / (konvaPoints.length / 2);

      const label = new Konva.Text({
        x: cx - 75, y: cy - 12,
        text: m.label, fontSize: 11, fontFamily: 'Arial', fill: mColor,
        align: 'center', width: 150,
      });
      const labelBg = new Konva.Rect({
        x: cx - 78, y: cy - 15,
        width: 156, height: label.height() + 6,
        fill: 'rgba(255,255,255,0.85)', cornerRadius: 2,
      });
      group.add(poly, labelBg, label);
      node = group;
      break;
    }

    case 'count': {
      const m = markup as CountMarkup;
      const pos = pdfToKonva(m.x, m.y, pageHeightPts);
      const size = m.size ?? 12;
      const group = new Konva.Group({ name: 'markup', id: markup.id, x: pos.x, y: pos.y });
      group.add(createCountSymbolShape(m.symbol, m.color, size));
      node = group;
      break;
    }

    default:
      // Unsupported markup type — render a placeholder group
      node = new Konva.Group({ name: 'markup', id: markup.id });
      break;
  }

  return node;
}

function bakeTransformForMarkup(markup: Markup, node: Konva.Node, pageHeightPts: number): void {
  const x = node.x();
  const y = node.y();

  if (markup.type === 'measure-linear') {
    const m = markup as MeasureLinearMarkup;
    const pdf1 = konvaToPdf(m.x1 + x, m.y1, pageHeightPts);
    const pdf2 = konvaToPdf(m.x2 + x, m.y2, pageHeightPts);
    // Simplified: just update x/y offset; label text stays the same (ideally recalculate)
    m.x1 = pdf1.x; m.y1 = konvaToPdf(0, m.y1, pageHeightPts).y;
    m.x2 = pdf2.x; m.y2 = konvaToPdf(0, m.y2, pageHeightPts).y;
    node.x(0); node.y(0);
  } else if (markup.type === 'measure-rect') {
    const m = markup as MeasureRectMarkup;
    const p = konvaRectToPdf(m.x + x, m.y - y, m.width, m.height, pageHeightPts);
    m.x = p.x; m.y = p.y;
    node.x(0); node.y(0);
  } else if (markup.type === 'measure-poly') {
    const m = markup as MeasurePolyMarkup;
    m.points = m.points.map(pt => {
      const k = pdfToKonva(pt.x, pt.y, pageHeightPts);
      const k2 = { x: k.x + x, y: k.y + y };
      return konvaToPdf(k2.x, k2.y, pageHeightPts);
    });
    node.x(0); node.y(0);
  } else if (markup.type === 'count') {
    const m = markup as CountMarkup;
    const pdf = konvaToPdf(m.x + x, m.y + y, pageHeightPts);
    m.x = pdf.x; m.y = pdf.y;
    node.x(0); node.y(0);
  }
}

// Suppress unused import warnings
void pdfPointsToKonva;
void konvaPointsToPdf;

// ── Factory ───────────────────────────────────────────────────────────────────

export function createKonvaStageManager(containerId: string): KonvaStageManager {
  const container = document.getElementById(containerId)!;
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;

  const stage = new Konva.Stage({ container: containerId, width: w, height: h });
  const bgLayer = new Konva.Layer();
  const markupLayer = new Konva.Layer();
  const interactionLayer = new Konva.Layer();
  stage.add(bgLayer, markupLayer, interactionLayer);

  let _pageHeightPts = 792;
  let _pageWidthPts = 612;
  let pdfImage: Konva.Image | null = null;

  return {
    stage,
    bgLayer,
    markupLayer,
    interactionLayer,

    get pageHeightPts() { return _pageHeightPts; },
    get pageWidthPts() { return _pageWidthPts; },

    setPdfImage(canvas: HTMLCanvasElement, widthPts: number, heightPts: number): void {
      _pageWidthPts = widthPts;
      _pageHeightPts = heightPts;
      bgLayer.destroyChildren();
      // Gray background
      bgLayer.add(new Konva.Rect({ x: -5000, y: -5000, width: 15000, height: 15000, fill: '#888' }));
      // White page background
      bgLayer.add(new Konva.Rect({ x: 0, y: 0, width: widthPts, height: heightPts, fill: '#fff' }));
      // PDF rendering
      pdfImage = new Konva.Image({ image: canvas, x: 0, y: 0, width: widthPts, height: heightPts });
      bgLayer.add(pdfImage);
      bgLayer.draw();
    },

    updatePdfCanvas(canvas: HTMLCanvasElement): void {
      if (pdfImage) { pdfImage.image(canvas); bgLayer.draw(); }
    },

    resize(widthPx: number, heightPx: number): void {
      stage.width(widthPx);
      stage.height(heightPx);
    },

    setZoom(zoom: number): void {
      const cx = stage.width() / 2;
      const cy = stage.height() / 2;
      stage.scale({ x: zoom, y: zoom });
      stage.position({ x: cx - (_pageWidthPts * zoom) / 2, y: cy - (_pageHeightPts * zoom) / 2 });
      stage.batchDraw();
    },

    addMarkupNode(markup: Markup): Konva.Node {
      const node = createMarkupNode(markup, _pageHeightPts);
      markupLayer.add(node as Konva.Group);
      markupLayer.draw();
      return node;
    },

    removeMarkupNode(id: string): void {
      markupLayer.findOne(`#${id}`)?.destroy();
      markupLayer.draw();
    },

    findNode(id: string): Konva.Node | undefined {
      return markupLayer.findOne(`#${id}`) ?? undefined;
    },

    updateMarkupNode(markup: Markup): void {
      markupLayer.findOne(`#${markup.id}`)?.destroy();
      const node = createMarkupNode(markup, _pageHeightPts);
      markupLayer.add(node as Konva.Group);
      markupLayer.draw();
    },

    bakeTransform(markup: Markup): void {
      const node = markupLayer.findOne(`#${markup.id}`);
      if (!node) return;
      bakeTransformForMarkup(markup, node, _pageHeightPts);
      this.updateMarkupNode(markup);
    },

    clearMarkups(): void {
      markupLayer.destroyChildren();
      markupLayer.draw();
    },

    getLayerPointer(): Point | null {
      const pos = stage.getPointerPosition();
      if (!pos) return null;
      const scale = stage.scaleX();
      const stagePos = stage.position();
      return {
        x: (pos.x - stagePos.x) / scale,
        y: (pos.y - stagePos.y) / scale,
      };
    },

    draw(): void { stage.batchDraw(); },
  };
}
