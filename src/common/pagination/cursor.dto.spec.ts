import 'reflect-metadata';
import { parseLimit } from './cursor.dto';

describe('parseLimit', () => {
  it('défaut 20 si undefined ou NaN', () => {
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit(Number.NaN)).toBe(20);
  });

  it('borne entre 1 et 50', () => {
    expect(parseLimit(0)).toBe(1);
    expect(parseLimit(10)).toBe(10);
    expect(parseLimit(100)).toBe(50);
  });
});
