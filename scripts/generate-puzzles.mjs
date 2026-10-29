#!/usr/bin/env node
// Generates the puzzle library (./puzzles.json) for the 4×4×4 and 9×9×9 cubes.
// Every puzzle has a unique solution that can be reached with human techniques:
// level 1 = naked/hidden singles, 2 = + locked candidates, 3 = + naked subsets.
// Usage: node scripts/generate-puzzles.mjs

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCube, generatePuzzle, countSolutions, mulberry32 } from "../js/engine.js";

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
];

const out = [];
const t0 = Date.now();
for (const t of tiers) {
  const cube = getCube(t.size);
  let seed = t.size * 1000 + ["easy", "medium", "hard", "expert"].indexOf(t.name) * 100;
  for (let k = 0; k < t.count; k++) {
    let g;
    do {
      g = generatePuzzle(cube, { level: t.level, minClues: t.minClues, rng: mulberry32(++seed) });
      // Expert puzzles must actually need more than singles.
    } while (t.name === "expert" && g.level < 2);
    if (countSolutions(cube, g.puzzle, 2) !== 1) throw new Error("puzzle is not unique");
    const id = out.filter((p) => p.size === t.size).length + 1;
    out.push({
      id: `${t.size}-${id}`,
      size: t.size,
      difficulty: t.name,
      clues: g.clues,
      level: g.level,
      puzzle: g.puzzle.join(""),
      solution: g.solution.join(""),
    });
    console.log(`${t.size}³ #${String(id).padStart(2, "0")} ${t.name.padEnd(6)} clues=${g.clues} level=${g.level}`);
  }
}

writeFileSync(outPath, JSON.stringify(out));
console.log(`\nWrote ${out.length} puzzles to ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
