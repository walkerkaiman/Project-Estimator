// All coordinates stored in PDF user-space (points = 1/72 inch), bottom-left origin.
// Y-flip is applied only when converting to/from screen space.

export interface Point {
  x: number;
  y: number;
}

export type MarkupType =
  | 'pen' | 'line' | 'arrow' | 'ellipse' | 'box' | 'text'
  | 'measure-linear' | 'measure-rect' | 'measure-poly'
  | 'count' | 'count-legend';

export type CountSymbol = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross';

export const COUNT_SYMBOLS: CountSymbol[] = ['circle', 'square', 'triangle', 'diamond', 'cross'];
export const COUNT_COLORS: string[] = [
  '#e63946', '#2196f3', '#4caf50', '#ff9800', '#9c27b0',
  '#00bcd4', '#ff5722', '#795548', '#607d8b', '#f06292',
];

export interface CountCategory {
  id: string;
  name: string;
  symbol: CountSymbol;
  color: string;
}

export interface LegendRow {
  label: string;
  symbol: CountSymbol;
  color: string;
  count: number;
}

export interface StrokeStyle {
  strokeColor: string;   // CSS hex
  strokeWidth: number;   // pts
  strokeOpacity: number; // 0-1
  strokeDash: boolean;
}

export interface FillStyle {
  fillColor: string;
  fillOpacity: number; // 0-1
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;    // pts
  bold: boolean;
  italic: boolean;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
}

export type MarkupStyle = Partial<StrokeStyle & FillStyle & TextStyle>;

export interface BaseMarkup {
  id: string;
  type: MarkupType;
  pageIndex: number;
  style: MarkupStyle;
}

export interface PenMarkup extends BaseMarkup {
  type: 'pen';
  points: number[]; // flat [x0,y0,x1,y1,...] in PDF pts (bottom-left origin)
}

export interface LineMarkup extends BaseMarkup {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
}

export interface ArrowMarkup extends BaseMarkup {
  type: 'arrow';
  x1: number; y1: number; x2: number; y2: number;
}

export interface EllipseMarkup extends BaseMarkup {
  type: 'ellipse';
  cx: number; cy: number; rx: number; ry: number;
}

export interface BoxMarkup extends BaseMarkup {
  type: 'box';
  x: number; y: number; width: number; height: number;
}

export interface TextMarkup extends BaseMarkup {
  type: 'text';
  x: number; y: number; width: number; height: number; // bottom-left origin
  text: string;
}

export interface MeasureLinearMarkup extends BaseMarkup {
  type: 'measure-linear';
  x1: number; y1: number; x2: number; y2: number;
  label: string;
}

export interface MeasureRectMarkup extends BaseMarkup {
  type: 'measure-rect';
  x: number; y: number; width: number; height: number;
  label: string;
}

export interface MeasurePolyMarkup extends BaseMarkup {
  type: 'measure-poly';
  points: Point[];
  label: string;
}

export interface CountMarkup extends BaseMarkup {
  type: 'count';
  x: number; y: number;
  categoryId: string;
  symbol: CountSymbol;
  color: string;
  size?: number;
}

export interface CountLegendMarkup extends BaseMarkup {
  type: 'count-legend';
  x: number; y: number;
  title: string;
  rows: LegendRow[];
  legendScale?: number;
}

export type Markup =
  | PenMarkup | LineMarkup | ArrowMarkup | EllipseMarkup
  | BoxMarkup | TextMarkup | MeasureLinearMarkup | MeasureRectMarkup | MeasurePolyMarkup
  | CountMarkup | CountLegendMarkup;

export interface PageScale {
  /** PDF points per one base unit (1 inch for imperial, 1 mm for metric) */
  pointsPerUnit: number;
  /** The real-world unit used during calibration */
  calibrationUnit: LinearUnit;
  calibrated: boolean;
}

export interface PageData {
  index: number;
  scale: PageScale;
  markups: Markup[];
  countCategories: CountCategory[];
  countSymbolSize?: number;
}

export type UnitSystem = 'imperial' | 'metric';
export type LinearUnit = 'in' | 'ft' | 'ft-in' | 'yd' | 'mm' | 'cm' | 'm';
export type AreaUnit = 'sqin' | 'sqft' | 'sqyd' | 'acres' | 'sqmm' | 'sqcm' | 'sqm';

export interface UnitsSettings {
  linearUnit: LinearUnit;
}

export interface ProjectData {
  version: number;
  pdfFileName: string;
  units: UnitsSettings;
  pages: PageData[];
}

export const DEFAULT_UNITS: UnitsSettings = {
  linearUnit: 'ft-in',
};

export const DEFAULT_PAGE_SCALE: PageScale = {
  pointsPerUnit: 0,
  calibrationUnit: 'in',
  calibrated: false,
};

export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  strokeColor: '#e63946',
  strokeWidth: 2,
  strokeOpacity: 1,
  strokeDash: false,
};

export const DEFAULT_FILL_STYLE: FillStyle = {
  fillColor: '#e63946',
  fillOpacity: 0.2,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 12,
  bold: false,
  italic: false,
  textColor: '#e63946',
  bgColor: '#ffffff',
  bgOpacity: 0.8,
};

export function generateId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
