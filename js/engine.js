// Grid geometry, solver and generator for sudoku in three and four dimensions.
//
// 3D (N×N×N, N = 4 or 9): every straight line along X, Y and Z contains each
// digit once, and every box in every slice — in all three orientations —
// contains each digit once. So each of the 3·N slices is itself a sudoku.
//
// 4D (4×4×4×4, the tesseract): every line along X, Y, Z and W contains 1–4,
// and every 2×2 box in five of the six plane orientations does too. All six
// is impossible for N = 4: the 16 cells of one 2×2×2×2 block would then need
// pairwise distinct digits whenever they differ in one or two coordinates,
// and a binary code of length 4 with distance 3 has only 2 words, so 8
// digits would be needed. The ZW plane is the one left without boxes, which
// keeps every W-slice a complete 3D sudoku.
//
// Cell index: i = x + N·y + N²·z (+ N³·w).

const gridCache = new Map();

export function getCube(n) {
  return getGrid(n, 3, []);
}

export function getTesseract(n = 4) {
  return getGrid(n, 4, [[2, 3]]);
}

function getGrid(n, d, missing) {
  const key = `${n}:${d}:${JSON.stringify(missing)}`;
  if (!gridCache.has(key)) gridCache.set(key, buildGrid(n, d, missing));
  return gridCache.get(key);
}

function buildGrid(n, d, missing) {
  const b = Math.round(Math.sqrt(n));
  const size = n ** d;
  const full = (1 << n) - 1;
  const stride = Array.from({ length: d }, (_, a) => n ** a);
  const index = (...c) => c.reduce((s, v, a) => s + v * stride[a], 0);
  const coords = new Array(size);
  for (let i = 0; i < size; i++) coords[i] = stride.map((st) => Math.floor(i / st) % n);

  const planes = [];
  for (let u = 0; u < d; u++) {
    for (let v = u + 1; v < d; v++) {
      if (!missing.some(([p, q]) => p === u && q === v)) planes.push([u, v]);
    }
  }

  // Houses: lines first, then boxes. `axis` is the direction of a line;
  // `plane` holds the two axes a box spans.
  const houses = [];
  const houseInfo = [];
  for (let axis = 0; axis < d; axis++) {
    for (let i = 0; i < size; i++) {
      if (coords[i][axis] !== 0) continue;
      houses.push(Array.from({ length: n }, (_, t) => i + t * stride[axis]));
      houseInfo.push({ kind: "line", axis });
    }
  }
  for (const [u, v] of planes) {
    for (let i = 0; i < size; i++) {
      if (coords[i][u] % b || coords[i][v] % b) continue;
      const cells = [];
      for (let du = 0; du < b; du++) {
        for (let dv = 0; dv < b; dv++) cells.push(i + du * stride[u] + dv * stride[v]);
      }
      houses.push(cells);
      houseInfo.push({ kind: "box", plane: [u, v] });
    }
  }

  const cellHouses = Array.from({ length: size }, () => []);
  houses.forEach((h, hi) => h.forEach((i) => cellHouses[i].push(hi)));

  const peers = new Array(size);
  for (let i = 0; i < size; i++) {
    const set = new Set();
    for (const hi of cellHouses[i]) for (const j of houses[hi]) if (j !== i) set.add(j);
    peers[i] = Int32Array.from(set);
  }

  // House pairs that overlap in two or more cells (box ∩ line, box ∩ box),
  // used for locked-candidate deductions.
  const overlaps = [];
  for (let h1 = 0; h1 < houses.length; h1++) {
    const s1 = new Set(houses[h1]);
    const seen = new Set();
    for (const i of houses[h1]) {
      for (const h2 of cellHouses[i]) {
        if (h2 === h1 || seen.has(h2)) continue;
        seen.add(h2);
        const inter = houses[h2].filter((j) => s1.has(j));
        if (inter.length >= 2) overlaps.push({ a: h1, b: h2, inter });
      }
    }
  }

  return { n, b, d, size, full, index, coords, planes, houses, houseInfo, cellHouses, peers, overlaps };
}

export const popcount = (m) => {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
};

export const bitToDigit = (bit) => 32 - Math.clz32(bit);

/** Candidate masks for every empty cell given the placed values. */
export function computeCandidates(cube, values) {
  const out = new Uint16Array(cube.size);
  for (let i = 0; i < cube.size; i++) {
    if (values[i]) continue;
    let m = cube.full;
    for (const p of cube.peers[i]) if (values[p]) m &= ~(1 << (values[p] - 1));
    out[i] = m;
  }
  return out;
}

/** Cells whose value clashes with a peer. */
export function findConflicts(cube, values) {
  const bad = new Set();
  for (const h of cube.houses) {
    const seen = new Map();
    for (const i of h) {
      const v = values[i];
      if (!v) continue;
      if (seen.has(v)) {
        bad.add(i);
        bad.add(seen.get(v));
      } else seen.set(v, i);
    }
  }
  return bad;
}

/* ------------------------------------------------------------------ */
/* Backtracking solver (bitmask candidates + singles propagation).    */
/* ------------------------------------------------------------------ */

function initState(cube, values) {
  const cands = new Uint16Array(cube.size).fill(cube.full);
  for (let i = 0; i < cube.size; i++) if (values[i]) cands[i] = 1 << (values[i] - 1);
  return { cands, placed: new Uint8Array(cube.size) };
}

function cloneState(s) {
  return { cands: s.cands.slice(), placed: s.placed.slice() };
}

function propagate(cube, s) {
  const { cands, placed } = s;
  const { size, peers, houses, full } = cube;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < size; i++) {
      if (placed[i]) continue;
      const m = cands[i];
      if (m === 0) return false;
      if ((m & (m - 1)) === 0) {
        placed[i] = 1;
        const ps = peers[i];
        for (let k = 0; k < ps.length; k++) {
          const p = ps[k];
          if (cands[p] & m) {
            cands[p] &= ~m;
            if (cands[p] === 0) return false;
            changed = true;
          }
        }
      }
    }
    for (let h = 0; h < houses.length; h++) {
      const cells = houses[h];
      let once = 0;
      let twice = 0;
      for (let k = 0; k < cells.length; k++) {
        const m = cands[cells[k]];
        twice |= once & m;
        once |= m;
      }
      if (once !== full) return false;
      const only = once & ~twice;
      if (!only) continue;
      for (let k = 0; k < cells.length; k++) {
        const i = cells[k];
        const m = cands[i] & only;
        if (m && cands[i] !== m) {
          if (m & (m - 1)) return false;
          cands[i] = m;
          changed = true;
        }
      }
    }
  }
  return true;
}

function search(cube, s, limit, found, rng) {
  if (!propagate(cube, s)) return 0;
  let best = -1;
  let bestCount = 99;
  for (let i = 0; i < cube.size; i++) {
    if (s.placed[i]) continue;
    const c = popcount(s.cands[i]);
    if (c < bestCount) {
      best = i;
      bestCount = c;
      if (c === 2) break;
    }
  }
  if (best < 0) {
    found.push(Array.from(s.cands, bitToDigit));
    return 1;
  }
  const bits = [];
  for (let m = s.cands[best]; m; m &= m - 1) bits.push(m & -m);
  if (rng) shuffle(bits, rng);
  let count = 0;
  for (const bit of bits) {
    const next = cloneState(s);
    next.cands[best] = bit;
    count += search(cube, next, limit - count, found, rng);
    if (count >= limit) break;
  }
  return count;
}

/** Number of solutions, capped at `limit`. */
export function countSolutions(cube, values, limit = 2) {
  return search(cube, initState(cube, values), limit, [], null);
}

/**
 * A random solved cube. Backtracking from scratch is far too slow for 9³,
 * so we build an affine solution over GF(b)² and then scramble it with the
 * rule-preserving symmetries: band and row shuffles per axis, an axis
 * permutation and a digit relabelling.
 */
export function randomSolution(cube, rng = Math.random) {
  if (cube.d !== 3) {
    // The 4×4×4×4 tesseract is small enough for randomised backtracking.
    const found = [];
    search(cube, initState(cube, new Uint8Array(cube.size)), 1, found, rng);
    return found[0];
  }
  const { n, b, size, index } = cube;
  const rand = (k) => Math.floor(rng() * k);
  const indep = (p, q) => (p[0] * q[1] - p[1] * q[0]) % b !== 0;
  // Columns for (x-band, x-row, y-band, y-row, z-band, z-row).
  let cols;
  do {
    cols = Array.from({ length: 6 }, () => [rand(b), rand(b)]);
  } while (
    !indep(cols[0], cols[1]) || !indep(cols[2], cols[3]) || !indep(cols[4], cols[5]) ||
    !indep(cols[1], cols[3]) || !indep(cols[1], cols[5]) || !indep(cols[3], cols[5])
  );

  const lineOrder = () => {
    const bands = shuffle([...Array(b).keys()], rng);
    return bands.flatMap((band) => shuffle([...Array(b).keys()], rng).map((r) => band * b + r));
  };
  const orders = [lineOrder(), lineOrder(), lineOrder()];
  const axes = shuffle([0, 1, 2], rng);
  const digits = shuffle([...Array(n).keys()].map((d) => d + 1), rng);

  const out = new Array(size);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const src = [x, y, z].map((c, a) => orders[a][c]);
        let v0 = 0;
        let v1 = 0;
        src.forEach((c, a) => {
          const band = (c / b) | 0;
          const row = c % b;
          v0 += cols[2 * a][0] * band + cols[2 * a + 1][0] * row;
          v1 += cols[2 * a][1] * band + cols[2 * a + 1][1] * row;
        });
        const p = [0, 0, 0];
        p[axes[0]] = x;
        p[axes[1]] = y;
        p[axes[2]] = z;
        out[index(p[0], p[1], p[2])] = digits[(v0 % b) * b + (v1 % b)];
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Human-style solver, used to grade and to give hints.               */
/* Levels: 1 = singles, 2 = + locked candidates, 3 = + naked subsets. */
/* ------------------------------------------------------------------ */

/**
 * Finds the next placement a person could deduce. Returns
 * { cell, digit, technique, house } or null. Candidate eliminations from
 * level-2/3 techniques are applied to `cands` in place.
 */
export function nextStep(cube, values, cands, level = 3) {
  for (;;) {
    const single = findSingle(cube, values, cands);
    if (single) return single;
    if (level < 2) return null;
    if (applyLockedCandidates(cube, values, cands)) continue;
    if (level < 3) return null;
    if (applyNakedSubsets(cube, values, cands)) continue;
    return null;
  }
}

function findSingle(cube, values, cands) {
  for (let i = 0; i < cube.size; i++) {
    if (values[i]) continue;
    const m = cands[i];
    if (m && (m & (m - 1)) === 0) return { cell: i, digit: bitToDigit(m), technique: "naked" };
  }
  for (let h = 0; h < cube.houses.length; h++) {
    const cells = cube.houses[h];
    for (let d = 0; d < cube.n; d++) {
      const bit = 1 << d;
      let spot = -1;
      let count = 0;
      for (const i of cells) {
        if (values[i] === d + 1) {
          count = -1;
          break;
        }
        if (!values[i] && cands[i] & bit) {
          spot = i;
          if (++count > 1) break;
        }
      }
      if (count === 1) return { cell: spot, digit: d + 1, technique: "hidden", house: h };
    }
  }
  return null;
}

function applyLockedCandidates(cube, values, cands) {
  let progress = false;
  for (const { a, b, inter } of cube.overlaps) {
    for (let d = 0; d < cube.n; d++) {
      const bit = 1 << d;
      let inside = false;
      let outside = false;
      for (const i of cube.houses[a]) {
        if (values[i] || !(cands[i] & bit)) continue;
        if (inter.includes(i)) inside = true;
        else {
          outside = true;
          break;
        }
      }
      if (!inside || outside) continue;
      for (const i of cube.houses[b]) {
        if (values[i] || inter.includes(i)) continue;
        if (cands[i] & bit) {
          cands[i] &= ~bit;
          progress = true;
        }
      }
    }
  }
  return progress;
}

function applyNakedSubsets(cube, values, cands) {
  let progress = false;
  for (const cells of cube.houses) {
    const open = cells.filter((i) => !values[i]);
    for (let size = 2; size <= 3; size++) {
      if (open.length <= size) continue;
      const pick = (start, chosen, mask) => {
        if (popcount(mask) > size) return;
        if (chosen.length === size) {
          if (popcount(mask) !== size) return;
          for (const i of open) {
            if (chosen.includes(i)) continue;
            if (cands[i] & mask) {
              cands[i] &= ~mask;
              progress = true;
            }
          }
          return;
        }
        for (let k = start; k < open.length; k++) {
          const c = cands[open[k]];
          if (popcount(c) > size) continue;
          pick(k + 1, [...chosen, open[k]], mask | c);
        }
      };
      pick(0, [], 0);
    }
  }
  return progress;
}

/** Places every naked and hidden single in one sweep. Returns the count, or -1 on a contradiction. */
function placeSingles(cube, values, cands) {
  let placed = 0;
  const place = (i, d) => {
    values[i] = d;
    cands[i] = 0;
    const bit = 1 << (d - 1);
    for (const p of cube.peers[i]) cands[p] &= ~bit;
    placed++;
  };
  for (let i = 0; i < cube.size; i++) {
    if (values[i]) continue;
    const m = cands[i];
    if (!m) return -1;
    if ((m & (m - 1)) === 0) place(i, bitToDigit(m));
  }
  for (const cells of cube.houses) {
    let once = 0;
    let twice = 0;
    let done = 0;
    for (const i of cells) {
      if (values[i]) {
        done |= 1 << (values[i] - 1);
        continue;
      }
      twice |= once & cands[i];
      once |= cands[i];
    }
    if ((once | done) !== cube.full) return -1;
    const only = once & ~twice & ~done;
    if (!only) continue;
    for (const i of cells) {
      const m = values[i] ? 0 : cands[i] & only;
      if (!m) continue;
      if (m & (m - 1)) return -1;
      place(i, bitToDigit(m));
    }
  }
  return placed;
}

/** Solves with human techniques only. Returns the hardest level needed, or 0 if stuck. */
export function gradePuzzle(cube, puzzle, maxLevel = 3) {
  const values = Uint8Array.from(puzzle);
  const cands = computeCandidates(cube, values);
  let hardest = 1;
  for (;;) {
    const placed = placeSingles(cube, values, cands);
    if (placed < 0) return 0;
    if (!values.includes(0)) return hardest;
    if (placed > 0) continue;
    if (maxLevel >= 2 && applyLockedCandidates(cube, values, cands)) {
      hardest = Math.max(hardest, 2);
      continue;
    }
    if (maxLevel >= 3 && applyNakedSubsets(cube, values, cands)) {
      hardest = 3;
      continue;
    }
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Generator                                                          */
/* ------------------------------------------------------------------ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Removes clues in random order while the puzzle stays solvable with
 * techniques up to `level`, stopping at `minClues`.
 */
export function generatePuzzle(cube, { level, minClues, rng = Math.random }) {
  const solution = randomSolution(cube, rng);
  const puzzle = solution.slice();
  let clues = cube.size;
  for (const i of shuffle([...Array(cube.size).keys()], rng)) {
    if (clues <= minClues) break;
    const keep = puzzle[i];
    puzzle[i] = 0;
    if (gradePuzzle(cube, puzzle, level)) clues--;
    else puzzle[i] = keep;
  }
  return { puzzle, solution, clues, level: gradePuzzle(cube, puzzle, 3) };
}
