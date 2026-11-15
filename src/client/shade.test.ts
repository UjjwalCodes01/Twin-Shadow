import { describe, expect, it } from 'vitest';
import { faceContacts, isUntouched, shadeAt, type ShadeWeights, type Solid } from './shade';

const WEIGHTS: ShadeWeights = { wall: 0.4, seam: 0.15, corner: 0.2, reach: 0.5 };

/** Solid where a listed block is, and everywhere below the board (the table). */
const world = (...blocks: string[]): Solid => {
  const set = new Set(blocks);
  return (x, y, z) => y < 0 || set.has(`${x},${y},${z}`);
};

// The +x face of a block: out along x, across along -z, up along y.
const sideFace = (cell: readonly [number, number, number], solid: Solid) =>
  faceContacts(cell, [1, 0, 0], [0, 0, -1], [0, 1, 0], solid, WEIGHTS);
// The top face: out along y, across along x, up along -z.
const topFace = (cell: readonly [number, number, number], solid: Solid) =>
  faceContacts(cell, [0, 1, 0], [1, 0, 0], [0, 0, -1], solid, WEIGHTS);

describe('faceContacts', () => {
  it('finds nothing on the top of a lone block', () => {
    expect(isUntouched(topFace([0, 0, 0], world('0,0,0')))).toBe(true);
  });

  it('finds the table along the bottom of a side face', () => {
    const contacts = sideFace([0, 0, 0], world('0,0,0'));
    expect(contacts.vLow).toBe(WEIGHTS.wall);
    expect(contacts.vHigh + contacts.uLow + contacts.uHigh).toBe(0);
  });

  it('does not find the table under a block that stands on another', () => {
    expect(sideFace([0, 1, 0], world('0,0,0', '0,1,0')).vLow).toBe(WEIGHTS.seam);
  });

  it('darkens a top face along the edge where a taller neighbour stands', () => {
    // A block at 1,1,0 rises beside the top of the block at 0,0,0.
    const contacts = topFace([0, 0, 0], world('0,0,0', '1,0,0', '1,1,0'));
    expect(contacts.uHigh).toBe(WEIGHTS.wall);
    expect(contacts.uLow).toBe(0);
  });

  it('marks only a seam where a neighbour sits flush', () => {
    const contacts = topFace([0, 0, 0], world('0,0,0', '1,0,0'));
    expect(contacts.uHigh).toBe(WEIGHTS.seam);
  });

  it('finds a block that touches at a corner only', () => {
    // Diagonally up from the top face's far corner: x+1 and z-1, one level up.
    const contacts = topFace([0, 0, 0], world('0,0,0', '1,1,-1'));
    expect(contacts.corners.highHigh).toBe(WEIGHTS.corner);
    expect(contacts.uHigh + contacts.vHigh).toBe(0);
  });

  it('does not count a corner twice when an edge already darkens it', () => {
    const contacts = topFace([0, 0, 0], world('0,0,0', '1,1,0', '1,1,-1'));
    expect(contacts.uHigh).toBe(WEIGHTS.wall);
    expect(contacts.corners.highHigh).toBe(0);
  });
});

describe('shadeAt', () => {
  const untouched = topFace([0, 0, 0], world('0,0,0'));
  const walled = topFace([0, 0, 0], world('0,0,0', '1,0,0', '1,1,0'));

  it('leaves an untouched face at full brightness everywhere', () => {
    for (const [a, b] of [[0, 0], [0.5, 0.5], [1, 1], [0.2, 0.9]] as const) {
      expect(shadeAt(a, b, untouched, WEIGHTS.reach)).toBe(1);
    }
  });

  it('is darkest at the touching edge and fades to nothing by the reach', () => {
    expect(shadeAt(1, 0.5, walled, WEIGHTS.reach)).toBeCloseTo(1 - WEIGHTS.wall);
    expect(shadeAt(0.8, 0.5, walled, WEIGHTS.reach)).toBeGreaterThan(shadeAt(1, 0.5, walled, WEIGHTS.reach));
    expect(shadeAt(0.5, 0.5, walled, WEIGHTS.reach)).toBe(1);
    expect(shadeAt(0, 0.5, walled, WEIGHTS.reach)).toBe(1);
  });

  it('never brightens and never goes black', () => {
    const boxedIn = topFace([0, 0, 0], world('0,0,0', '1,1,0', '-1,1,0', '0,1,1', '0,1,-1'));
    for (let a = 0; a <= 1; a += 0.25) {
      for (let b = 0; b <= 1; b += 0.25) {
        const shade = shadeAt(a, b, boxedIn, WEIGHTS.reach);
        expect(shade).toBeLessThanOrEqual(1);
        expect(shade).toBeGreaterThan(0.3);
      }
    }
  });
});
