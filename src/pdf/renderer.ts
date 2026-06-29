import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';

// pdfjs-dist v4: worker file is pdf.worker.min.mjs (or pdf.worker.mjs)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

export interface PageInfo {
  pageNumber: number;     // 1-indexed
  widthPts: number;       // PDF user-space width in points
  heightPts: number;      // PDF user-space height in points
  canvas: HTMLCanvasElement;
  viewport: PageViewport;
}

export interface PdfRenderer {
  doc: PDFDocumentProxy;
  numPages: number;
  loadPage(pageIndex: number, scale: number): Promise<PageInfo>;
  getPageSizePts(pageIndex: number): Promise<{ widthPts: number; heightPts: number }>;
  destroy(): void;
}

/**
 * Load a PDF from a Uint8Array and return a renderer.
 */
export async function loadPdf(bytes: Uint8Array): Promise<PdfRenderer> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const doc = await loadingTask.promise;

  return {
    doc,
    numPages: doc.numPages,

    async loadPage(pageIndex: number, scale: number): Promise<PageInfo> {
      const page: PDFPageProxy = await doc.getPage(pageIndex + 1); // pdf.js is 1-indexed
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const ctx = canvas.getContext('2d')!;
      // v4: render only needs canvasContext + viewport
      await page.render({ canvasContext: ctx, viewport }).promise;

      // PDF user-space dimensions at scale=1
      const baseViewport = page.getViewport({ scale: 1 });

      return {
        pageNumber: pageIndex + 1,
        widthPts: baseViewport.width,
        heightPts: baseViewport.height,
        canvas,
        viewport,
      };
    },

    async getPageSizePts(pageIndex: number): Promise<{ widthPts: number; heightPts: number }> {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      return { widthPts: viewport.width, heightPts: viewport.height };
    },

    destroy(): void {
      doc.destroy();
    },
  };
}

/**
 * Compute a zoom level that fits the page width into the given container width.
 */
export function fitWidthScale(pageWidthPts: number, containerWidth: number, margin = 40): number {
  return Math.max(0.1, (containerWidth - margin * 2) / pageWidthPts);
}

/**
 * Compute a zoom level that fits the page into the given container.
 */
export function fitPageScale(
  pageWidthPts: number, pageHeightPts: number,
  containerWidth: number, containerHeight: number,
  margin = 40
): number {
  const scaleW = (containerWidth - margin * 2) / pageWidthPts;
  const scaleH = (containerHeight - margin * 2) / pageHeightPts;
  return Math.max(0.1, Math.min(scaleW, scaleH));
}
