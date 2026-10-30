#!/usr/bin/env node
// Generates the puzzle library (./puzzles.json): the 4×4×4 and 9×9×9 cubes,
// the 4×4×4×4 tesseract and the 9×9×9×9 hypercube.
// Every puzzle has a unique solution that can be reached with human techniques:
// level 1 = naked/hidden singles, 2 = + locked candidates, 3 = + naked subsets.
// Usage: node scripts/generate-puzzles.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCube, getTesseract, getHypercube, generatePuzzle, countSolutions, mulberry32 } from "../js/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "puzzles.json");

const tiers = [
  { size: 4, name: "easy", count: 10, level: 1, minClues: 18 },
  { size: 4, name: "medium", count: 10, level: 1, minClues: 11 },
  { size: 4, name: "hard", count: 10, level: 1, minClues: 0 },
  { size: 9, name: "easy", count: 8, level: 1, minClues: 300 },
  { size: 9, name: "medium", count: 8, level: 1, minClues: 170 },
  { size: 9, name: "hard", count: 8, level: 1, minClues: 90 },
  { size: 9, name: "expert", count: 6, level: 3, minClues: 0 },
  { size: 4, dims: 4, name: "easy", count: 10, level: 1, minClues: 96 },
  { size: 4, dims: 4, name: "medium", count: 10, level: 1, minClues: 40 },
  { size: 4, dims: 4, name: "hard", count: 10, level: 1, minClues: 0 },
  { size: 9, dims: 4, name: "easy", count: 4, level: 1, minClues: 2600 },
  { size: 9, dims: 4, name: "medium", count: 4, level: 1, minClues: 1300 },
  { size: 9, dims: 4, name: "hard", count: 4, level: 1, minClues: 500 },
  { size: 9, dims: 4, name: "expert", count: 4, level: 1, minClues: 0 },
];

const out = [];
const t0 = Date.now();
for (const t of tiers) {
  const dims = t.dims || 3;
  const cube = dims === 3 ? getCube(t.size) : t.size === 9 ? getHypercube(9) : getTesseract(t.size);
  const prefix = dims === 3 ? String(t.size) : t.size === 9 ? "h" : "t";
  // Seeds are fixed per family so regenerating never changes a published puzzle.
  const base = dims === 3 ? t.size * 1000 : t.size === 9 ? 90000 : 40000;
  let seed = base + ["easy", "medium", "hard", "expert"].indexOf(t.name) * 100;
  for (let k = 0; k < t.count; k++) {
    let g;
    do {
      g = generatePuzzle(cube, { level: t.level, minClues: t.minClues, rng: mulberry32(++seed) });
      // Expert puzzles must actually need more than singles.
    } while (t.name === "expert" && dims === 3 && g.level < 2);
    if (countSolutions(cube, g.puzzle, 2) !== 1) throw new Error("puzzle is not unique");
    const id = out.filter((p) => p.id.startsWith(`${prefix}-`)).length + 1;
    out.push({
      id: `${prefix}-${id}`,
      size: t.size,
      dims,
      difficulty: t.name,
      clues: g.clues,
      level: g.level,
      puzzle: g.puzzle.join(""),
      solution: g.solution.join(""),
    });
    console.log(`${t.size}^${dims} #${String(id).padStart(2, "0")} ${t.name.padEnd(6)} clues=${g.clues} level=${g.level}`);
  }
}

writeFileSync(outPath, JSON.stringify(out));
console.log(`\nWrote ${out.length} puzzles to ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
