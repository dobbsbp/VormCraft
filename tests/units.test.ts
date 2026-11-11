import { afterEach, describe, expect, it } from 'vitest';
import { Document } from '../src/doc/Document';
import { DEFAULT_UNITS, UNIT_CHOICES, validUnits, type DisplayUnits } from '../src/doc/Units';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { activeUnits, formatArea, formatLength, formatLengths, parseLength, parseLengths } from '../src/tools/units';
import { harness } from './helpers/tools';

const cm: DisplayUnits = { unit: 'cm', precision: 1 };
const ftin: DisplayUnits = { unit: 'ftin', precision: 16 };

describe('lengths in the design units', () => {
  it('formats in each unit, to the chosen precision, without trailing zeros', () => {
    expect(formatLength(1234.567, DEFAULT_UNITS)).toBe('1234.57 mm');
    expect(formatLength(1234.567, cm)).toBe('123.5 cm');
    expect(formatLength(1250, { unit: 'm', precision: 3 })).toBe('1.25 m');
    expect(formatLength(76.2, { unit: 'in', precision: 2 })).toBe('3 in');
    expect(formatLength(914.4, { unit: 'ft', precision: 3 })).toBe('3 ft');
    expect(formatLength(-0.001, cm)).toBe('0 cm');
  });

  it('formats feet and inches with fractions, reduced', () => {
    expect(formatLength(1066.8 + 12.7, ftin)).toBe(`3' 6 1/2"`);
    expect(formatLength(19.05, ftin)).toBe('3/4"');
    expect(formatLength(914.4 + 19.05, ftin)).toBe(`3' 0 3/4"`);
    expect(formatLength(914.4, ftin)).toBe(`3' 0"`);
    expect(formatLength(152.4, ftin)).toBe('6"');
    expect(formatLength(-19.05, ftin)).toBe('-3/4"');
    expect(formatLength(25.4 * 1.03, { unit: 'ftin', precision: 8 })).toBe('1"');
  });

  it('several lengths share the unit; areas are squared units', () => {
    expect(formatLengths([300, 200, 100], ' × ', cm)).toBe('30 × 20 × 10 cm');
    expect(formatLengths([304.8, 25.4], ', ', ftin)).toBe(`1' 0", 1"`);
    expect(formatArea(600, DEFAULT_UNITS)).toBe('600 mm²');
    expect(formatArea(2e6, DEFAULT_UNITS)).toBe('2 m²');
    expect(formatArea(2e4, cm)).toBe('200 cm²');
    expect(formatArea(92903.04, ftin)).toBe('1 ft²');
  });

  it('a plain number is read in the design units; a typed unit wins', () => {
    expect(parseLength('12', cm)).toBe(120);
    expect(parseLength('12mm', cm)).toBe(12);
    expect(parseLength('6', ftin)).toBeCloseTo(152.4);
    expect(parseLength('1.5', { unit: 'm', precision: 3 })).toBe(1500);
    expect(parseLength('-2', cm)).toBe(-20);
  });

  it('reads fractions of an inch, and what feet and inches are shown as', () => {
    expect(parseLength(`3' 6 1/2"`)).toBeCloseTo(1079.5);
    expect(parseLength('6 1/2"')).toBeCloseTo(165.1);
    expect(parseLength('3/4"')).toBeCloseTo(19.05);
    expect(parseLength('3/4', ftin)).toBeCloseTo(19.05);
    expect(parseLength(`3' 0"`)).toBeCloseTo(914.4);
    expect(parseLength('1/0"')).toBeUndefined();
    for (const mm of [19.05, 152.4, 1079.5, 3048]) expect(parseLength(formatLength(mm, ftin), ftin)).toBeCloseTo(mm);
  });

  it('only known units and precisions are accepted', () => {
    expect(validUnits({ unit: 'cm', precision: 1 })).toEqual(cm);
    expect(validUnits({ unit: 'cm', precision: 16 })).toBeUndefined();
    expect(validUnits({ unit: 'yd', precision: 1 })).toBeUndefined();
    expect(validUnits(null)).toBeUndefined();
    for (const c of UNIT_CHOICES) expect(validUnits({ unit: c.unit, precision: c.precision })).toBeDefined();
  });
});

describe('the design units', () => {
  afterEach(() => {
    // Put the shared active units back for the other tests.
    harness();
  });

  it('a new document is in millimetres; units are saved with the design', () => {
    const doc = new Document();
    expect(doc.units).toEqual(DEFAULT_UNITS);
    doc.units = ftin;
    expect(parseDocument(serializeDocument(doc)).units).toEqual(ftin);
  });

  it('a file without units, or with units that cannot be read, opens in millimetres', () => {
    const text = JSON.parse(serializeDocument(new Document()));
    delete text.displayUnits;
    expect(parseDocument(JSON.stringify(text)).units).toEqual(DEFAULT_UNITS);
    text.displayUnits = { unit: 'furlong', precision: 2 };
    expect(parseDocument(JSON.stringify(text)).units).toEqual(DEFAULT_UNITS);
  });

  it('changing units is one undo step, changes what typing means and leaves the model alone', () => {
    const h = harness();
    expect(activeUnits()).toEqual(DEFAULT_UNITS);
    h.controller.setUnits(cm);
    expect(h.doc.units).toEqual(cm);
    expect(activeUnits()).toEqual(cm);
    expect(parseLengths('30,20')).toEqual([300, 200]);
    expect(h.controller.history.undoLabel).toBe('Units');
    expect(h.controller.dirty).toBe(true);
    h.controller.undo();
    expect(h.doc.units).toEqual(DEFAULT_UNITS);
    expect(activeUnits()).toEqual(DEFAULT_UNITS);
    // The same units again is not a change.
    h.controller.setUnits({ ...DEFAULT_UNITS });
    expect(h.controller.history.undoLabel).not.toBe('Units');
  });

  it('opening a design takes its units', () => {
    const h = harness();
    const other = new Document();
    other.units = cm;
    h.controller.replaceDocument(other);
    expect(h.doc.units).toEqual(cm);
    expect(activeUnits()).toEqual(cm);
  });
});
