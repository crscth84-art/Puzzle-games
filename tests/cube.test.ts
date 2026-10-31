import { describe, expect, it } from "vitest";
import {
  applyMove, applyMoves, FACES, generateScramble, invertMove, isMove, isSolved,
  nextHint, simplify, solvedCube, type Move,
} from "@/lib/cube";

const seeded = (seed: number) => (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};

describe("cube model", () => {
  it("starts solved", () => {
    expect(isSolved(solvedCube())).toBe(true);
    expect(solvedCube()).toHaveLength(26);
  });

  it("each quarter turn has order 4 and unsolves the cube", () => {
    for (const f of FACES) {
      const once = applyMove(solvedCube(), f);
      expect(isSolved(once)).toBe(false);
      expect(isSolved(applyMoves(solvedCube(), [f, f, f, f]))).toBe(true);
      expect(isSolved(applyMoves(solvedCube(), [f, `${f}'` as Move]))).toBe(true);
      expect(isSolved(applyMoves(solvedCube(), [`${f}2` as Move, `${f}2` as Move]))).toBe(true);
      expect(applyMoves(solvedCube(), [f, f])).toEqual(applyMove(solvedCube(), `${f}2` as Move));
    }
  });

  it("sexy move (R U R' U') has order 6", () => {
    const seq: Move[] = ["R", "U", "R'", "U'"];
    let s = solvedCube();
    for (let i = 1; i <= 6; i++) {
      s = applyMoves(s, seq);
      expect(isSolved(s)).toBe(i === 6);
    }
  });

  it("matches standard notation: R moves the front-right edge up to the top", () => {
    // R clockwise (viewed from the right) carries the F-R edge (1,0,1) to U-R (1,1,0)
    const s = applyMove(solvedCube(), "R");
    const edge = s.find((c) => c.home.join() === "1,0,1")!;
    expect(edge.pos).toEqual([1, 1, 0]);
    // U clockwise (viewed from top) carries the U-F edge (0,1,1) to U-L (-1,1,0)
    const u = applyMove(solvedCube(), "U").find((c) => c.home.join() === "0,1,1")!;
    expect(u.pos).toEqual([-1, 1, 0]);
    // F clockwise carries U-F edge (0,1,1) to F-R (1,0,1)
    const f = applyMove(solvedCube(), "F").find((c) => c.home.join() === "0,1,1")!;
    expect(f.pos).toEqual([1, 0, 1]);
  });

  it("twisting one corner in place is detected as unsolved", () => {
    // (R' D' R D) x2 twists the DFR corner without moving anything else... until repeated 3x
    const seq: Move[] = ["R'", "D'", "R", "D", "R'", "D'", "R", "D"];
    expect(isSolved(applyMoves(solvedCube(), seq))).toBe(false);
    expect(isSolved(applyMoves(solvedCube(), [...seq, ...seq, ...seq]))).toBe(true);
  });

  it("validates move strings", () => {
    for (const m of ["U", "D'", "F2", "B", "L'", "R2"]) expect(isMove(m)).toBe(true);
    for (const m of ["", "u", "X", "R3", "R''", "RR", " R", "R ", "<script>", 5, null, {}]) expect(isMove(m)).toBe(false);
    expect(() => applyMove(solvedCube(), "X" as Move)).toThrow();
  });

  it("inverts moves", () => {
    expect(invertMove("R")).toBe("R'");
    expect(invertMove("R'")).toBe("R");
    expect(invertMove("R2")).toBe("R2");
  });

  it("simplifies sequences", () => {
    expect(simplify(["R", "R'"])).toEqual([]);
    expect(simplify(["R", "R", "R"])).toEqual(["R'"]);
    expect(simplify(["R", "L", "R'"])).toEqual(["L"]);
    expect(simplify(["L", "R", "L", "R'"])).toEqual(["L2"]);
    expect(simplify(["U", "R", "R'", "U'"])).toEqual([]);
    expect(simplify(["F", "R2", "U"])).toEqual(["F", "R2", "U"]);
  });

  it("simplify never changes the resulting cube", () => {
    const rnd = seeded(7);
    for (let t = 0; t < 200; t++) {
      const seq = Array.from({ length: 30 }, () => `${"UDLRFB"[rnd(6)]}${["", "'", "2"][rnd(3)]}` as Move);
      expect(applyMoves(solvedCube(), simplify(seq))).toEqual(applyMoves(solvedCube(), seq));
    }
  });

  it("generates valid scrambles that do not repeat a face", () => {
    const rnd = seeded(42);
    for (let t = 0; t < 100; t++) {
      const s = generateScramble(20, rnd);
      expect(s).toHaveLength(20);
      s.forEach((m, i) => {
        expect(isMove(m)).toBe(true);
        if (i > 0) expect(m[0]).not.toBe(s[i - 1][0]);
      });
      expect(isSolved(applyMoves(solvedCube(), s))).toBe(false);
    }
  });

  it("following hints always solves the cube", () => {
    const rnd = seeded(99);
    for (let t = 0; t < 50; t++) {
      const scramble = generateScramble(20, rnd);
      const moves: Move[] = Array.from({ length: rnd(15) }, () => `${"UDLRFB"[rnd(6)]}${["", "'", "2"][rnd(3)]}` as Move);
      let guard = 0;
      for (let h = nextHint(scramble, moves); h; h = nextHint(scramble, moves)) {
        moves.push(h);
        if (++guard > 100) throw new Error("hints did not converge");
      }
      expect(isSolved(applyMoves(applyMoves(solvedCube(), scramble), moves))).toBe(true);
    }
  });

  it("returns no hint when solved", () => {
    expect(nextHint([], [])).toBeNull();
    expect(nextHint(["R"], ["R'"])).toBeNull();
    expect(nextHint(["R"], [])).toBe("R'");
  });
});
