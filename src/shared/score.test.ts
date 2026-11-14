import { describe, expect, it } from 'vitest';
import { canonicalSculpture, sortBlocks, starsFor } from './score';

describe('starsFor', () => {
  const par = 9;

  it('gives 3 stars at par', () => {
    expect(starsFor(par, par)).toBe(3);
  });

  it('gives 3 stars under par', () => {
    expect(starsFor(par - 1, par)).toBe(3);
    expect(starsFor(1, par)).toBe(3);
  });

  it('gives 2 stars from 1 to 3 blocks over par', () => {
    expect(starsFor(par + 1, par)).toBe(2);
    expect(starsFor(par + 3, par)).toBe(2);
  });

  it('gives 1 star at 4 blocks over par and beyond', () => {
    expect(starsFor(par + 4, par)).toBe(1);
    expect(starsFor(par + 40, par)).toBe(1);
  });
});

describe('canonicalSculpture', () => {
  it('is the same string whatever order the blocks were placed in', () => {
    const blocks = ['2,1,0', '0,0,0', '0,0,1', '1,1,0', '2,0,2', '0,1,0'];
    expect(canonicalSculpture(blocks)).toBe(canonicalSculpture([...blocks].reverse()));
    expect(canonicalSculpture(new Set(blocks))).toBe(canonicalSculpture(blocks));
  });

  it('sorts by height, then depth, then left to right, by number not by text', () => {
    expect(sortBlocks(['10,0,0', '2,0,0', '0,1,0', '0,0,1'])).toEqual(['2,0,0', '10,0,0', '0,0,1', '0,1,0']);
    expect(canonicalSculpture(['0,1,0', '0,0,0'])).toBe('0,0,0;0,1,0');
  });

  it('differs for different sculptures', () => {
    expect(canonicalSculpture(['0,0,0', '1,0,0'])).not.toBe(canonicalSculpture(['0,0,0', '0,0,1']));
  });
});
