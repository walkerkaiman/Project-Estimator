import type { LinearUnit, PageScale } from '../model/document.ts';
import { PTS_PER_INCH } from './units.ts';

/**
 * Compute pointsPerRealInch from a calibration measurement.
 *
 * @param distancePts   measured distance in PDF points between two clicked points
 * @param realValue     user-entered real-world length
 * @param realUnit      unit of the entered length
 */
export function computeScale(distancePts: number, realValue: number, realUnit: LinearUnit): PageScale {
  if (distancePts <= 0 || realValue <= 0) {
    return { pointsPerUnit: 0, calibrationUnit: realUnit, calibrated: false };
  }

  // Convert real value to inches
  let realInches: number;
  switch (realUnit) {
    case 'in':    realInches = realValue; break;
    case 'ft':    realInches = realValue * 12; break;
    case 'ft-in': realInches = realValue * 12; break; // caller should pass feet as decimal
    case 'yd':    realInches = realValue * 36; break;
    case 'mm':    realInches = realValue / 25.4; break;
    case 'cm':    realInches = realValue / 2.54; break;
    case 'm':     realInches = realValue / 0.0254; break;
    default:      realInches = realValue;
  }

  // pointsPerRealInch = how many PDF points correspond to 1 real inch
  const pointsPerRealInch = distancePts / realInches;

  return {
    pointsPerUnit: pointsPerRealInch,
    calibrationUnit: realUnit,
    calibrated: true,
  };
}

/** Verify scale is reasonable for construction drawings (0.001 to 1000 pts/inch) */
export function isScaleReasonable(scale: PageScale): boolean {
  return scale.calibrated && scale.pointsPerUnit > 0.001 && scale.pointsPerUnit < 100000;
}

/** 
 * Convert a distance in PDF points to real inches using stored scale.
 * Returns NaN if scale not calibrated. 
 */
export function ptsToInches(distancePts: number, scale: PageScale): number {
  if (!scale.calibrated || scale.pointsPerUnit <= 0) return NaN;
  return distancePts / scale.pointsPerUnit;
}

/** 
 * Get pointsPerRealInch (the key calibration value).
 * pointsPerUnit is stored as points-per-real-inch.
 */
export function getPointsPerInch(scale: PageScale): number {
  return scale.pointsPerUnit;
}

/** Default PDF printing scale: 72 pts = 1 inch (actual size, 1:1) */
export const UNCALIBRATED_SCALE: PageScale = {
  pointsPerUnit: PTS_PER_INCH,
  calibrationUnit: 'in',
  calibrated: false,
};
