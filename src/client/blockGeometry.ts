// The shape of one wooden block: a cube with softened edges, built here so
// that every face has enough points across it to carry contact shading, and
// so that each point knows which face it is on and where.

import * as THREE from 'three';

export type Vector = readonly [number, number, number];

/** Which lamp a face leans towards, or `top` for the faces that show end grain. */
export type FaceKind = 'warm' | 'cool' | 'top';

/** One face: `normal` points out of it, `u` runs across it and `v` up it. */
export type BlockFace = { normal: Vector; u: Vector; v: Vector; kind: FaceKind };

/**
 * The six faces. The faces across the front lamp's light (front and back)
 * lean warm; the faces across the side lamp's light (left and right) lean
 * cool. In three.js space the front-to-back axis is z. Faces of one kind sit
 * together, so each kind is drawn in one go with one material.
 */
export const BLOCK_FACES: readonly BlockFace[] = [
  { normal: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], kind: 'cool' },
  { normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], kind: 'cool' },
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], kind: 'top' },
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], kind: 'top' },
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], kind: 'warm' },
  { normal: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], kind: 'warm' },
];

/** The kinds in the order a block's three materials are given: one per pair of faces. */
export const FACE_KINDS: readonly FaceKind[] = ['cool', 'top', 'warm'];

export type BlockShape = {
  /** Positions, normals, texture coordinates and triangles, shared by every block. */
  base: THREE.BufferGeometry;
  vertexCount: number;
  /** For each point: which of BLOCK_FACES it is on. */
  faceOf: Uint8Array;
  /** For each point: how far across its face it is, and how far up, each from 0 to 1. */
  across: Float32Array;
  up: Float32Array;
};

/** A cube of side 1 centred on the origin, its edges rounded to `radius`. */
export const createBlockShape = (radius: number): BlockShape => {
  // Lines across a face: one at each rim, one where the flat part begins, and
  // three between, so shading can fade over half a face.
  const flat = 0.5 - radius;
  const lines = [-0.5, -flat, -0.25, 0, 0.25, flat, 0.5];
  const perSide = lines.length;
  const perFace = perSide * perSide;
  const vertexCount = perFace * BLOCK_FACES.length;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const faceOf = new Uint8Array(vertexCount);
  const across = new Float32Array(vertexCount);
  const up = new Float32Array(vertexCount);
  const index: number[] = [];
  const faceRanges: { start: number; count: number }[] = [];
  const base = new THREE.BufferGeometry();

  BLOCK_FACES.forEach(({ normal, u, v }, face) => {
    lines.forEach((upLine, row) => {
      lines.forEach((acrossLine, column) => {
        const vertex = face * perFace + row * perSide + column;
        // A point on the sharp cube, pulled in to the rounded one: it moves
        // to `radius` away from the nearest point of a smaller cube inside.
        const sharp = [0, 1, 2].map((axis) => (normal[axis] ?? 0) * 0.5 + (u[axis] ?? 0) * acrossLine + (v[axis] ?? 0) * upLine);
        const inner = sharp.map((value) => Math.min(Math.max(value, -flat), flat));
        const out = sharp.map((value, axis) => value - (inner[axis] ?? 0));
        const length = Math.hypot(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0) || 1;
        for (let axis = 0; axis < 3; axis++) {
          const direction = (out[axis] ?? 0) / length;
          positions[vertex * 3 + axis] = (inner[axis] ?? 0) + direction * radius;
          normals[vertex * 3 + axis] = direction;
        }
        uvs[vertex * 2] = acrossLine + 0.5;
        uvs[vertex * 2 + 1] = upLine + 0.5;
        faceOf[vertex] = face;
        across[vertex] = acrossLine + 0.5;
        up[vertex] = upLine + 0.5;
      });
    });
    const start = index.length;
    for (let row = 0; row < perSide - 1; row++) {
      for (let column = 0; column < perSide - 1; column++) {
        const corner = face * perFace + row * perSide + column;
        // Anticlockwise seen from outside, since across x up points out of the face.
        index.push(corner, corner + 1, corner + perSide + 1, corner, corner + perSide + 1, corner + perSide);
      }
    }
    faceRanges.push({ start, count: index.length - start });
  });

  // One group per kind of face (two faces each), so each kind has its own material.
  FACE_KINDS.forEach((kind, material) => {
    const ranges = faceRanges.filter((_, face) => BLOCK_FACES[face]?.kind === kind);
    const first = ranges[0];
    if (first) base.addGroup(first.start, ranges.reduce((total, range) => total + range.count, 0), material);
  });

  base.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  base.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  base.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  base.setIndex(index);
  return { base, vertexCount, faceOf, across, up };
};

/**
 * The geometry for one block: the shared shape, with its own shading (one
 * brightness per point, all full to begin with).
 */
export const blockGeometry = (shape: BlockShape): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attribute = shape.base.getAttribute(name);
    geometry.setAttribute(name, attribute);
  }
  geometry.setIndex(shape.base.getIndex());
  for (const group of shape.base.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(shape.vertexCount * 3).fill(1), 3));
  // All blocks are the same size, so the bounds can be shared too.
  geometry.boundingSphere = shape.base.boundingSphere;
  geometry.boundingBox = shape.base.boundingBox;
  return geometry;
};
