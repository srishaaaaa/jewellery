export interface UnitOption {
  value: string
  label: string
  group: string
  unitType: 'unit' | 'weight' | 'volume' | 'bundle'
  unit: string
  suffix: string
}

// Grouped for <optgroup> dropdowns. Covers the units a typical kirana / provisional store
// actually sells in; "Other" lets the owner type anything not listed here.
export const UNIT_OPTIONS: UnitOption[] = [
  { value: 'kg', label: 'Kilogram (kg)', group: 'Weight', unitType: 'weight', unit: 'kg', suffix: 'kg' },
  { value: 'gram', label: 'Gram (gm)', group: 'Weight', unitType: 'weight', unit: 'g', suffix: 'gm' },
  { value: 'litre', label: 'Litre (L)', group: 'Volume', unitType: 'volume', unit: 'l', suffix: 'L' },
  { value: 'ml', label: 'Millilitre (ml)', group: 'Volume', unitType: 'volume', unit: 'ml', suffix: 'ml' },
  { value: 'pcs', label: 'Piece (pcs)', group: 'Count', unitType: 'unit', unit: 'piece', suffix: 'pcs' },
  { value: 'dozen', label: 'Dozen (dz)', group: 'Count', unitType: 'unit', unit: 'dozen', suffix: 'dz' },
  { value: 'packet', label: 'Packet', group: 'Packaging', unitType: 'bundle', unit: 'packet', suffix: 'packet' },
  { value: 'box', label: 'Box', group: 'Packaging', unitType: 'bundle', unit: 'box', suffix: 'box' },
  { value: 'bag', label: 'Bag', group: 'Packaging', unitType: 'bundle', unit: 'bag', suffix: 'bag' },
  { value: 'bundle', label: 'Bundle', group: 'Packaging', unitType: 'bundle', unit: 'bundle', suffix: 'bundle' },
  { value: 'bottle', label: 'Bottle', group: 'Packaging', unitType: 'bundle', unit: 'bottle', suffix: 'bottle' },
  { value: 'tin', label: 'Tin / Can', group: 'Packaging', unitType: 'bundle', unit: 'tin', suffix: 'tin' },
  { value: 'pouch', label: 'Pouch / Sachet', group: 'Packaging', unitType: 'bundle', unit: 'pouch', suffix: 'pouch' },
  { value: 'custom', label: 'Other (type your own)', group: 'Other', unitType: 'unit', unit: 'custom', suffix: '' },
]
export const UNIT_GROUPS = ['Weight', 'Volume', 'Count', 'Packaging', 'Other']

// Returns null (rather than a fallback guess) when nothing matches, so the caller can fall
// back to the "Other" custom-unit input instead of silently picking the wrong unit.
export const findUnitOption = (unitType: string, unit: string): UnitOption | null =>
  UNIT_OPTIONS.find((o) => o.value !== 'custom' && o.unitType === unitType && o.unit === unit) || null
