/**
 * Unit tests for the formula expression engine.
 *
 * All values are synthetic — no real costs or recipes.
 */

import { describe, it, expect } from 'vitest';
import { evalFormula, buildVars } from '../formulaEngine.ts';

describe('evalFormula — arithmetic', () => {
  it('evaluates simple addition', () => expect(evalFormula('2 + 3', {})).toBe(5));
  it('evaluates subtraction', () => expect(evalFormula('10 - 4', {})).toBe(6));
  it('evaluates multiplication', () => expect(evalFormula('3 * 4', {})).toBe(12));
  it('evaluates division', () => expect(evalFormula('10 / 4', {})).toBe(2.5));
  it('respects operator precedence', () => expect(evalFormula('2 + 3 * 4', {})).toBe(14));
  it('handles parentheses', () => expect(evalFormula('(2 + 3) * 4', {})).toBe(20));
  it('handles unary minus', () => expect(evalFormula('-3 + 5', {})).toBe(2));
  it('handles exponentiation', () => expect(evalFormula('2^10', {})).toBe(1024));
});

describe('evalFormula — built-in functions', () => {
  it('ROUNDUP integer', () => expect(evalFormula('ROUNDUP(2.1, 0)', {})).toBe(3));
  it('ROUNDUP to 1dp', () => expect(evalFormula('ROUNDUP(2.11, 1)', {})).toBe(2.2));
  it('ROUNDDOWN', () => expect(evalFormula('ROUNDDOWN(2.9, 0)', {})).toBe(2));
  it('ROUND half-up', () => expect(evalFormula('ROUND(2.5, 0)', {})).toBe(3));
  it('ABS negative', () => expect(evalFormula('ABS(-5)', {})).toBe(5));
  it('SUM multiple', () => expect(evalFormula('SUM(1, 2, 3)', {})).toBe(6));
  it('MIN', () => expect(evalFormula('MIN(10, 3, 7)', {})).toBe(3));
  it('MAX', () => expect(evalFormula('MAX(10, 3, 7)', {})).toBe(10));
  it('SQRT', () => expect(evalFormula('SQRT(16)', {})).toBe(4));
});

describe('evalFormula — IF / comparisons', () => {
  it('IF true branch', () => expect(evalFormula('IF(1 > 0, 10, 20)', {})).toBe(10));
  it('IF false branch', () => expect(evalFormula('IF(0 > 1, 10, 20)', {})).toBe(20));
  it('comparison equal', () => expect(evalFormula('5 = 5', {})).toBe(1));
  it('comparison not equal', () => expect(evalFormula('5 <> 6', {})).toBe(1));
  it('comparison less-than-or-equal', () => expect(evalFormula('3 <= 3', {})).toBe(1));
});

describe('evalFormula — variables', () => {
  const vars = { Length: 40, Height: 3, factor: 1 };

  it('uses Length variable', () => expect(evalFormula('Length', vars)).toBe(40));

  it('plywood one-sided formula (Height > 2 → double sheets)', () => {
    const result = evalFormula(
      'IF(Height>2, ROUNDUP(factor*2*(Length/32),0), ROUNDUP(factor*(Length/32),0))',
      vars,
    );
    // 40 LF, Height 3 ft → 2 sides: ROUNDUP(1*2*(40/32)) = ROUNDUP(2.5) = 3
    expect(result).toBe(3);
  });

  it('plywood one-sided formula (Height <= 2 → single side)', () => {
    const result = evalFormula(
      'IF(Height>2, ROUNDUP(factor*2*(Length/32),0), ROUNDUP(factor*(Length/32),0))',
      { ...vars, Height: 2 },
    );
    // ROUNDUP(40/32) = ROUNDUP(1.25) = 2
    expect(result).toBe(2);
  });

  it('labor quantity equals Length', () => expect(evalFormula('Length', vars)).toBe(40));
});

describe('evalFormula — error handling', () => {
  it('returns NaN for empty formula', () => expect(evalFormula('', {})).toBeNaN());
  it('returns NaN for unknown variable', () => expect(evalFormula('Foo', {})).toBeNaN());
  it('returns NaN for unknown function', () => expect(evalFormula('NOOP(1)', {})).toBeNaN());
});

describe('buildVars', () => {
  it('capitalises role names', () => {
    const vars = buildVars([
      { role: 'length', value: 10 },
      { role: 'height', value: 2 },
    ]);
    expect(vars['Length']).toBe(10);
    expect(vars['Height']).toBe(2);
  });

  it('merges extras', () => {
    const vars = buildVars([{ role: 'length', value: 5 }], { factor: 0.5 });
    expect(vars['factor']).toBe(0.5);
  });
});
