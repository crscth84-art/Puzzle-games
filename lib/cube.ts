/**
 * Pure Rubik's cube model shared by the browser (rendering) and the server
 * (validating moves, generating hints, verifying solves).
 *
 * The cube is 26 visible cubies on integer coordinates in {-1,0,1}^3.
 * +x = Right, +y = Up, +z = Front. Each cubie keeps its home position, its
 * current position and an integer rotation matrix (row-major 3x3).
 */

export const FACES = ["U", "D", "L", "R", "F", "B"] as const;
export type Face = (typeof FACES)[number];
export type Move = Face | `${Face}'` | `${Face}2`;

export type Vec3 = [number, number, number];
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Cubie {
  home: Vec3;
  pos: Vec3;
  rot: Mat3;
}

export type CubeState = Cubie[];

export const MAX_MOVES = 5000;
const MOVE_RE = /^[UDLRFB]['2]?$/;

export function isMove(value: unknown): value is Move {
  return typeof value === "string" && MOVE_RE.test(value);
}

/** Axis (0=x,1=y,2=z), which layer, and the rotation sign of a clockwise turn. */
export const FACE_DEF: Record<Face, { axis: 0 | 1 | 2; layer: 1 | -1; sign: 1 | -1 }> = {
  R: { axis: 0, layer: 1, sign: -1 },
  L: { axis: 0, layer: -1, sign: 1 },
  U: { axis: 1, layer: 1, sign: -1 },
  D: { axis: 1, layer: -1, sign: 1 },
  F: { axis: 2, layer: 1, sign: -1 },
  B: { axis: 2, layer: -1, sign: 1 },
};

const OPPOSITE: Record<Face, Face> = { U: "D", D: "U", L: "R", R: "L", F: "B", B: "F" };

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function solvedCube(): CubeState {
  const cubies: CubeState = [];
  for (let x = -1; x <= 1; x++)
    for (let y = -1; y <= 1; y++)
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        cubies.push({ home: [x, y, z], pos: [x, y, z], rot: [...IDENTITY] as Mat3 });
      }
  return cubies;
}

/** Quarter turns (1..3) a move represents in the clockwise direction. */
export function quarterTurns(move: Move): 1 | 2 | 3 {
  if (move.endsWith("2")) return 2;
  if (move.endsWith("'")) return 3;
  return 1;
}

/** Signed angle in quarter turns used for animation (prime = -1, double = 2). */
export function animationQuarters(move: Move): number {
  const f = move[0] as Face;
  const q = move.endsWith("2") ? 2 : move.endsWith("'") ? -1 : 1;
  return FACE_DEF[f].sign * q;
}

function rotationMatrix(axis: 0 | 1 | 2, s: 1 | -1): Mat3 {
  // 90 degrees * s about the axis (cos = 0, sin = s)
  if (axis === 0) return [1, 0, 0, 0, 0, -s, 0, s, 0];
  if (axis === 1) return [0, 0, s, 0, 1, 0, -s, 0, 0];
  return [0, -s, 0, s, 0, 0, 0, 0, 1];
}

function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[i * 3 + k] * b[k * 3 + j];
      r[i * 3 + j] = sum + 0; // + 0 normalizes -0
    }
  return r;
}

function mulVec(m: Mat3, v: Vec3): Vec3 {
  // + 0 normalizes -0 so states compare/serialize identically
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + 0,
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2] + 0,
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2] + 0,
  ];
}

export function applyMove(state: CubeState, move: Move): CubeState {
  if (!isMove(move)) throw new Error(`Invalid move: ${String(move)}`);
  const face = move[0] as Face;
  const { axis, layer, sign } = FACE_DEF[face];
  const r = rotationMatrix(axis, sign);
  const turns = quarterTurns(move);
  return state.map((c) => {
    if (c.pos[axis] !== layer) return c;
    let pos = c.pos;
    let rot = c.rot;
    for (let i = 0; i < turns; i++) {
      pos = mulVec(r, pos);
      rot = mulMat(r, rot);
    }
    return { home: c.home, pos, rot };
  });
}

export function applyMoves(state: CubeState, moves: readonly Move[]): CubeState {
  return moves.reduce(applyMove, state);
}

function isCenter(v: Vec3): boolean {
  return Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) === 1;
}

/** Centers never move with face turns, so solved = every other cubie home & unrotated. */
export function isSolved(state: CubeState): boolean {
  return state.every((c) => {
    if (isCenter(c.home)) return true;
    return (
      c.pos[0] === c.home[0] &&
      c.pos[1] === c.home[1] &&
      c.pos[2] === c.home[2] &&
      c.rot.every((v, i) => v === IDENTITY[i])
    );
  });
}

export function invertMove(move: Move): Move {
  const f = move[0] as Face;
  const q = quarterTurns(move);
  return toMove(f, 4 - q);
}

function toMove(face: Face, q: number): Move {
  const n = ((q % 4) + 4) % 4;
  if (n === 1) return face;
  if (n === 2) return `${face}2`;
  if (n === 3) return `${face}'`;
  throw new Error("zero turn has no move");
}

/**
 * Simplify a move sequence: merge consecutive turns of the same face and
 * turns of the same face separated only by its (commuting) opposite face.
 */
export function simplify(moves: readonly Move[]): Move[] {
  // Removing a merged turn can expose new merges, so repeat until stable.
  let current = simplifyPass(moves);
  for (;;) {
    const next = simplifyPass(current);
    if (next.length === current.length) return next;
    current = next;
  }
}

function simplifyPass(moves: readonly Move[]): Move[] {
  const stack: { face: Face; q: number }[] = [];
  for (const m of moves) {
    const face = m[0] as Face;
    const q = quarterTurns(m);
    const top = stack[stack.length - 1];
    const below = stack[stack.length - 2];
    let target: { face: Face; q: number } | undefined;
    let targetIndex = -1;
    if (top && top.face === face) {
      target = top;
      targetIndex = stack.length - 1;
    } else if (top && below && top.face === OPPOSITE[face] && below.face === face) {
      target = below;
      targetIndex = stack.length - 2;
    }
    if (target) {
      target.q = (target.q + q) % 4;
      if (target.q === 0) stack.splice(targetIndex, 1);
    } else {
      stack.push({ face, q });
    }
  }
  return stack.map((s) => toMove(s.face, s.q));
}

/**
 * Hint: the next move that walks back along the (simplified) path from the
 * solved state. Following hints always makes progress toward solved.
 * Returns null when the cube is already solved.
 */
export function nextHint(scramble: readonly Move[], moves: readonly Move[]): Move | null {
  if (isSolved(applyMoves(applyMoves(solvedCube(), scramble), moves))) return null;
  const path = simplify([...scramble, ...moves]);
  const last = path[path.length - 1];
  return last ? invertMove(last) : null;
}

/** Random scramble with no two consecutive turns on the same axis-face pair. */
export function generateScramble(length: number, randomInt: (maxExclusive: number) => number): Move[] {
  const out: Move[] = [];
  const mods = ["", "'", "2"] as const;
  while (out.length < length) {
    const face = FACES[randomInt(FACES.length)];
    const prev = out[out.length - 1]?.[0] as Face | undefined;
    const prev2 = out[out.length - 2]?.[0] as Face | undefined;
    if (face === prev) continue;
    if (prev && face === prev2 && prev === OPPOSITE[face]) continue;
    out.push(`${face}${mods[randomInt(3)]}` as Move);
  }
  return out;
}

export function describeMove(move: Move): string {
  const names: Record<Face, string> = {
    U: "Up (top)",
    D: "Down (bottom)",
    L: "Left",
    R: "Right",
    F: "Front",
    B: "Back",
  };
  const face = move[0] as Face;
  const dir = move.endsWith("2")
    ? "twice (180°)"
    : move.endsWith("'")
      ? "counter-clockwise"
      : "clockwise";
  return `Turn the ${names[face]} face ${dir}`;
}
