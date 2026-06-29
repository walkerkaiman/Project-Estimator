/**
 * Coordinate system helpers.
 *
 * PDF space:    bottom-left origin, Y increases upward, units = points (1/72 inch)
 * Konva space:  top-left origin, Y increases downward, units = "PDF points at scale 1"
 *               i.e. konvaX = pdfX,  konvaY = pageHeightPts - pdfY
 * Screen space: Konva space * zoom + stage pan
 *
 * We store all markup in PDF space. Konva shapes are placed in Konva space.
 * pdf-lib uses PDF space directly (same origin as stored coords).
 */

export interface Pt { x: number; y: number; }

/** Convert PDF point coords → Konva layer coords (Konva space = PDF space with Y flipped) */
export function pdfToKonva(pdfX: number, pdfY: number, pageHeightPts: number): Pt {
  return { x: pdfX, y: pageHeightPts - pdfY };
}

/** Convert Konva layer coords → PDF point coords */
export function konvaToPdf(kx: number, ky: number, pageHeightPts: number): Pt {
  return { x: kx, y: pageHeightPts - ky };
}

/** Convert a flat points array [x0,y0,x1,y1,...] from PDF space to Konva space */
export function pdfPointsToKonva(pdfPoints: number[], pageHeightPts: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pdfPoints.length; i += 2) {
    out.push(pdfPoints[i]);
    out.push(pageHeightPts - pdfPoints[i + 1]);
  }
  return out;
}

/** Convert a flat points array from Konva space to PDF space */
export function konvaPointsToPdf(konvaPoints: number[], pageHeightPts: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < konvaPoints.length; i += 2) {
    out.push(konvaPoints[i]);
    out.push(pageHeightPts - konvaPoints[i + 1]);
  }
  return out;
}

/** Convert a rect defined in PDF space (bottom-left) to Konva space (top-left) */
export function pdfRectToKonva(
  pdfX: number, pdfY: number, width: number, height: number, pageHeightPts: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: pdfX,
    y: pageHeightPts - pdfY - height,
    width,
    height,
  };
}

/** Convert a Konva rect (top-left) back to PDF rect (bottom-left) */
export function konvaRectToPdf(
  kx: number, ky: number, width: number, height: number, pageHeightPts: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: kx,
    y: pageHeightPts - ky - height,
    width,
    height,
  };
}

/** Euclidean distance between two PDF-space points */
export function distance(a: Pt, b: Pt): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/** Shoelace formula: area of a polygon given its vertices (in any consistent unit) */
export function polygonArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Perimeter of a polygon */
export function polygonPerimeter(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    p += distance(pts[i], pts[(i + 1) % pts.length]);
  }
  return p;
}
