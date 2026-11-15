// Contact shading: how much darker a point on a block's face is because of
// what the block is touching. A face darkens towards an edge where a
// neighbour, or the table, stands up from it, and a little along a seam where
// a neighbour sits flush beside it. No DOM and no three.js.

/** What lies along each edge of a face, and at each corner. */
export type FaceContacts = {
  /** Strength of the darkening along each edge: 0 for none. u runs across the face, v up it. */
  uLow: number;
  uHigh: number;
  vLow: number;
  vHigh: number;
  /** Darkening at a corner that has something at the corner only. */
  corners: { lowLow: number; lowHigh: number; highLow: number; highHigh: number };
};

export type ShadeWeights = {
  /** A neighbour, or the table, standing up from the edge: an inside corner. */
  wall: number;
  /** A neighbour flush beside the face: just the seam between two blocks. */
  seam: number;
  /** Something at a corner only. */
  corner: number;
  /** How far into the face the darkening reaches, as a share of the face. */
  reach: number;
};

/** Whether a cell is solid: a block that rests on something, or the table below the board. */
export type Solid = (x: number, y: number, z: number) => boolean;

type Vector = readonly [number, number, number];

const plus = (a: Vector, b: Vector, scale = 1): Vector => [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];

/**
 * What touches one face of the block at `cell`. `normal` points out of the
 * face; `u` and `v` are the directions across and up it.
 */
export const faceContacts = (
  cell: Vector,
  normal: Vector,
  u: Vector,
  v: Vector,
  solid: Solid,
  weights: ShadeWeights
): FaceContacts => {
  const is = (at: Vector): boolean => solid(at[0], at[1], at[2]);
  const front = plus(cell, normal);
  const edge = (direction: Vector, sign: 1 | -1): number => {
    if (is(plus(front, direction, sign))) return weights.wall;
    return is(plus(cell, direction, sign)) ? weights.seam : 0;
  };
  const uLow = edge(u, -1);
  const uHigh = edge(u, 1);
  const vLow = edge(v, -1);
  const vHigh = edge(v, 1);
  const corner = (uSign: 1 | -1, vSign: 1 | -1, beside: number, above: number): number =>
    // Only when neither edge already darkens the corner.
    beside < weights.wall && above < weights.wall && is(plus(plus(front, u, uSign), v, vSign)) ? weights.corner : 0;
  return {
    uLow,
    uHigh,
    vLow,
    vHigh,
    corners: {
      lowLow: corner(-1, -1, uLow, vLow),
      lowHigh: corner(-1, 1, uLow, vHigh),
      highLow: corner(1, -1, uHigh, vLow),
      highHigh: corner(1, 1, uHigh, vHigh),
    },
  };
};

const falloff = (distance: number, reach: number): number => (distance >= reach ? 0 : (1 - distance / reach) ** 2);

/**
 * Brightness at a point on a face, from 1 (untouched) down. `a` and `b` are
 * the point's place across and up the face, each from 0 to 1.
 */
export const shadeAt = (a: number, b: number, contacts: FaceContacts, reach: number): number => {
  const { uLow, uHigh, vLow, vHigh, corners } = contacts;
  const cornerDistance = (da: number, db: number): number => Math.hypot(da, db);
  return (
    (1 - uLow * falloff(a, reach)) *
    (1 - uHigh * falloff(1 - a, reach)) *
    (1 - vLow * falloff(b, reach)) *
    (1 - vHigh * falloff(1 - b, reach)) *
    (1 - corners.lowLow * falloff(cornerDistance(a, b), reach)) *
    (1 - corners.lowHigh * falloff(cornerDistance(a, 1 - b), reach)) *
    (1 - corners.highLow * falloff(cornerDistance(1 - a, b), reach)) *
    (1 - corners.highHigh * falloff(cornerDistance(1 - a, 1 - b), reach))
  );
};

/** True when nothing touches the face, so it needs no shading at all. */
export const isUntouched = ({ uLow, uHigh, vLow, vHigh, corners }: FaceContacts): boolean =>
  uLow + uHigh + vLow + vHigh + corners.lowLow + corners.lowHigh + corners.highLow + corners.highHigh === 0;
