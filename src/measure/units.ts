import type { LinearUnit } from '../model/document.ts';

/**
 * Units engine for construction measurements.
 * All raw measurements start in PDF points (1/72 inch = 1 pt).
 * We convert via a page-level scale factor (pts per real unit).
 */

// PDF points per inch (constant)
export const PTS_PER_INCH = 72;

// Conversion factors from inches to other linear units
const INCH_TO_UNIT: Record<string, number> = {
  in:    1,
  ft:    1 / 12,
  'ft-in': 1,      // handled separately
  yd:    1 / 36,
  mm:    25.4,
  cm:    2.54,
  m:     0.0254,
};

// Area unit labels
export const AREA_LABELS: Record<string, string> = {
  in:    'sq in',
  ft:    'sq ft',
  'ft-in': 'sq ft',
  yd:    'sq yd',
  mm:    'sq mm',
  cm:    'sq cm',
  m:     'sq m',
};

export const LINEAR_LABELS: Record<LinearUnit, string> = {
  in:    'in',
  ft:    'ft',
  'ft-in': 'ft-in',
  yd:    'yd',
  mm:    'mm',
  cm:    'cm',
  m:     'm',
};

/**
 * Convert a distance in PDF points to the target display unit,
 * using the page's scale factor.
 *
 * @param distancePts  distance in PDF points
 * @param pointsPerRealInch  how many PDF points = 1 real inch on the drawing (from calibration)
 * @param unit  target display unit
 * @returns formatted string
 */
export function formatLinear(distancePts: number, pointsPerRealInch: number, unit: LinearUnit): string {
  if (pointsPerRealInch <= 0) return '—';
  const inches = distancePts / pointsPerRealInch;

  if (unit === 'ft-in') {
    return formatFeetInches(inches);
  }

  const converted = inches * (INCH_TO_UNIT[unit] ?? 1);
  return `${converted.toFixed(2).replace(/\.?0+$/, '')} ${LINEAR_LABELS[unit]}`;
}

/**
 * Convert an area in PDF points² to the display unit.
 */
export function formatArea(areaPts2: number, pointsPerRealInch: number, unit: LinearUnit): string {
  if (pointsPerRealInch <= 0) return '—';
  const areaIn2 = areaPts2 / (pointsPerRealInch ** 2);

  let areaConverted: number;
  let label: string;

  if (unit === 'ft-in' || unit === 'ft') {
    areaConverted = areaIn2 / 144;
    label = 'sq ft';
  } else if (unit === 'in') {
    areaConverted = areaIn2;
    label = 'sq in';
  } else if (unit === 'yd') {
    areaConverted = areaIn2 / 1296;
    label = 'sq yd';
  } else if (unit === 'm') {
    areaConverted = areaIn2 * 0.00064516;
    label = 'sq m';
  } else if (unit === 'cm') {
    areaConverted = areaIn2 * 6.4516;
    label = 'sq cm';
  } else if (unit === 'mm') {
    areaConverted = areaIn2 * 645.16;
    label = 'sq mm';
  } else {
    areaConverted = areaIn2;
    label = 'sq in';
  }

  return `${areaConverted.toFixed(2).replace(/\.?0+$/, '')} ${label}`;
}

/**
 * Format inches as architectural feet-inches with fractional inches.
 * e.g. 14.5 in → 1'-2½"
 */
export function formatFeetInches(totalInches: number): string {
  const negative = totalInches < 0;
  const abs = Math.abs(totalInches);
  const feet = Math.floor(abs / 12);
  const remainingInches = abs - feet * 12;
  const wholeInches = Math.floor(remainingInches);
  const fraction = remainingInches - wholeInches;

  const fractionStr = decimalToFraction(fraction, 16);
  let result = '';
  if (feet > 0) result += `${feet}'`;
  if (wholeInches > 0 || fractionStr || feet === 0) {
    result += (result ? '-' : '') + `${wholeInches}`;
    if (fractionStr) result += ` ${fractionStr}`;
    result += '"';
  }
  return (negative ? '-' : '') + result;
}

/** Convert decimal fraction to nearest 1/denominator string (e.g. 0.5 → "1/2") */
function decimalToFraction(decimal: number, denominator: number): string {
  if (decimal < 1 / (denominator * 2)) return '';
  const numerator = Math.round(decimal * denominator);
  if (numerator === 0) return '';
  if (numerator === denominator) return '1'; // whole inch
  const gcd = greatestCommonDivisor(numerator, denominator);
  return `${numerator / gcd}/${denominator / gcd}`;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/** Build the scale label shown in the status bar */
export function formatScaleLabel(pointsPerRealInch: number, unit: LinearUnit): string {
  if (pointsPerRealInch <= 0) return 'Not calibrated';
  // How many PDF pts = 1 inch? pointsPerRealInch
  // Drawing scale e.g. "1" = 10'" means 72pts = 10*12 = 120 real inches
  const ptsPerInch = PTS_PER_INCH; // 72
  const realInchesPerDrawingInch = pointsPerRealInch / ptsPerInch;
  if (realInchesPerDrawingInch >= 12) {
    const realFeet = realInchesPerDrawingInch / 12;
    return `1" = ${realFeet % 1 === 0 ? realFeet : realFeet.toFixed(2)}'`;
  }
  return `1" = ${realInchesPerDrawingInch.toFixed(2)}"`;
}
