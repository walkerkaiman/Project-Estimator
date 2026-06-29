/**
 * Synthetic example catalog — committed to the repo for tests and first-run.
 *
 * All prices, rates, and recipe factors are FICTIONAL placeholder values.
 * They demonstrate the data shape without revealing any real company data.
 *
 * The importer script (scripts/importFableXlsx.ts) overwrites this with real
 * numbers pulled from the git-ignored source spreadsheet.
 */

import type { Catalog } from './catalog.ts';
import { CATALOG_VERSION } from './catalog.ts';

export const EXAMPLE_CATALOG: Catalog = {
  version: CATALOG_VERSION,

  vendors: [
    { id: 'vendor-a', name: 'Example Supplier A' },
    { id: 'vendor-b', name: 'Example Supplier B' },
  ],

  units: [
    { id: 'each',   label: 'Each',        abbr: 'ea'    },
    { id: 'lf',     label: 'Linear Feet', abbr: 'LF'    },
    { id: 'sqft',   label: 'Square Feet', abbr: 'sq ft' },
    { id: 'yards',  label: 'Cubic Yards', abbr: 'yd³'   },
    { id: 'sheets', label: 'Sheets',      abbr: 'sh'    },
    { id: 'rolls',  label: 'Rolls',       abbr: 'rl'    },
    { id: 'gal',    label: 'Gallons',     abbr: 'gal'   },
    { id: 'hr',     label: 'Hours',       abbr: 'hr'    },
  ],

  materials: [
    {
      id: 'mat-plywood-3-4',
      name: 'Plywood 3/4" (4x8)',
      unit: 'sheets',
      unitCost: 0,          // ← real cost loaded from importer / in-app edit
      vendor: 'vendor-a',
      notes: '',
    },
    {
      id: 'mat-form-oil',
      name: 'Form Oil',
      unit: 'gal',
      unitCost: 0,
      vendor: 'vendor-a',
      notes: '',
    },
    {
      id: 'mat-tie-wire',
      name: 'Tie Wire',
      unit: 'rolls',
      unitCost: 0,
      vendor: 'vendor-b',
      notes: '',
    },
    {
      id: 'mat-rebar-5',
      name: '#5 Rebar',
      unit: 'lf',
      unitCost: 0,
      vendor: 'vendor-b',
      notes: '',
    },
  ],

  phases: [
    { id: 'phase-foundation', name: 'Foundation', order: 0 },
    { id: 'phase-slab',       name: 'Slab',       order: 1 },
  ],

  tasks: [
    {
      id: 'task-form-one-sided',
      phaseId: 'phase-foundation',
      name: 'Build Forms – One Sided',
      laborUnit: 'LF',
      laborRate: 0,                // ← real rate loaded from importer / in-app edit
      laborQtyFormula: 'Length',
      scopeInputs: [
        { role: 'length', label: 'Length (ft)',       unit: 'ft', required: true  },
        { role: 'height', label: 'Height / Depth (ft)', unit: 'ft', required: true },
      ],
      recipe: [
        {
          materialId: 'mat-plywood-3-4',
          factor: 1,
          orderQtyFormula: 'IF(Height>2, ROUNDUP(1*2*(Length/32),0), ROUNDUP(1*(Length/32),0))',
        },
        {
          materialId: 'mat-form-oil',
          factor: 0.05,
          orderQtyFormula: 'ROUNDUP(0.05*Length, 1)',
        },
      ],
    },
    {
      id: 'task-pour-footer',
      phaseId: 'phase-foundation',
      name: 'Pour Footer',
      laborUnit: 'LF',
      laborRate: 0,
      laborQtyFormula: 'Length',
      scopeInputs: [
        { role: 'length', label: 'Length (ft)', unit: 'ft', required: true },
        { role: 'width',  label: 'Width (ft)',  unit: 'ft', required: true },
        { role: 'height', label: 'Height (ft)', unit: 'ft', required: true },
      ],
      recipe: [],   // concrete yards calculated via formula in the engine
    },
  ],
};
