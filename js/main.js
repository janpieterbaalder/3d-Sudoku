import { getCube, getTesseract, getHypercube, computeCandidates, findConflicts, nextStep } from "./engine.js";
import { CubeScene, THEMES, slotMap } from "./scene.js";

const STORAGE_KEY = "sudoku3d.state.v1";
const TIER_LABEL = { easy: "Eenvoudig", medium: "Gemiddeld", hard: "Moeilijk", expert: "Expert" };
// Puzzle families, keyed by the id prefix in puzzles.json.
const GROUPS = {
  4: { label: "Mini", size: 4, dims: 3 },
  9: { label: "Kubus", size: 9, dims: 3 },
  t: { label: "Tesseract", size: 4, dims: 4 },
  h: { label: "Hyperkubus", size: 9, dims: 4 },
};
const groupOf = (p) => p.id.split("-")[0];
const HERO = {
  4: ["Echte 3D-sudoku", "Elke snede van de kubus is een sudoku. In alle drie de richtingen."],
  9: ["Echte 3D-sudoku", "Elke snede van de kubus is een sudoku. In alle drie de richtingen."],
  t: ["Sudoku in vier dimensies", "Vier kubussen, verbonden door een vierde richting: W."],
  h: ["De volledige 4D-regel", "6561 cellen. Elke snede, in alle zes de vlakken, is een sudoku."],
};
const gridOf = (g) => (g.dims === 3 ? getCube(g.size) : g.size === 9 ? getHypercube(9) : getTesseract(g.size));
const LINE_NAME = ["rij", "kolom", "pilaar", "W-lijn"];
const AXES = "XYZW";
// Mode buttons keep their ids; in the tesseract "Kubus" shows everything and "Laag" one cube.
const MODE_LABELS = {
  3: { cube: ["Kubus", "Hele kubus"], layer: ["Laag", "Eén laag"], focus: ["Focus", "Focus op cel"] },
  4: { cube: ["Alles", "Hele tesseract"], layer: ["Kubus", "Eén kubus"], focus: ["Focus", "Focus op cel"] },
};
const THEME_COLOR = { dark: "#05070c", light: "#ece8e1" };

const $ = (id) => document.getElementById(id);
const els = {
  body: document.body,
  back: $("back"),
  topbar: document.querySelector(".topbar"),
  brand: $("brand"),
  gameTitle: $("game-title"),
  gtName: $("gt-name"),
  gtMeta: $("gt-meta"),
  hud: $("hud"),
  hero: $("hero"),
  reset: $("reset"),
  helpBtn: $("help-btn"),
  settingsBtn: $("settings-btn"),
  stage: $("stage"),
  picker: $("picker"),
  controls: $("controls"),
  list: $("puzzle-list"),
  sizeTabs: document.querySelectorAll(".size-tab"),
  tierTabs: document.querySelectorAll(".tier-tab"),
  rulesCard: $("rules-card"),
  metaDiff: $("meta-diff"),
  metaProgress: $("meta-progress"),
  metaTime: $("meta-time"),
  viewReset: $("view-reset"),
  viewFace: $("view-face"),
  modeSeg: $("mode-seg"),
  axisSeg: $("axis-seg"),
  layerPrev: $("layer-prev"),
  layerNext: $("layer-next"),
  layerLabel: $("layer-label"),
  pad: $("pad"),
  undo: $("undo"),
  notes: $("notes"),
  autonotes: $("autonotes"),
  hint: $("hint"),
  erase: $("erase"),
  toast: $("toast"),
  solved: $("solved"),
  solvedTime: $("solved-time"),
  solvedList: $("solved-list"),
  solvedNext: $("solved-next"),
  help: $("help"),
  settings: $("settings"),
  themeSeg: $("theme-seg"),
  spacing: $("spacing"),
  autoFace: $("auto-face"),
  assist: $("assist"),
  webglError: $("webgl-error"),
  themeMeta: document.querySelector('meta[name="theme-color"]'),
};

/* -------------------- Persistence -------------------- */

const store = {
  load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { puzzles: parsed.puzzles || {}, last: parsed.last ?? null, settings: parsed.settings || {}, group: parsed.group ?? parsed.size };
    } catch {
      return { puzzles: {}, last: null, settings: {} };
    }
  },
  save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private mode or quota: progress simply isn't kept */
    }
  },
};

const persisted = store.load();
const settings = Object.assign({ theme: "dark", spacing: 0.3, autoFace: true, assist: false }, persisted.settings);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let puzzles = [];
let scene = null;
let game = null;
const ui = { view: "picker", group: GROUPS[persisted.group] ? String(persisted.group) : "9", tier: "all" };

function persist() {
  if (game) {
    persisted.puzzles[game.id] = {
      v: Array.from(game.values).join(""),
      nt: game.notes.some((m) => m) ? Array.from(game.notes) : [],
      done: game.completed,
      time: liveTime(),
      view: { m: game.mode, a: game.axis, l: game.layer },
    };
  }
  persisted.settings = settings;
  persisted.group = ui.group;
  store.save(persisted);
}

/* -------------------- Init -------------------- */

async function init() {
  applyThemeChrome();
  try {
    const res = await fetch("puzzles.json");
    puzzles = await res.json();
  } catch {
    els.list.innerHTML = `<p class="load-error">Kon de puzzels niet laden.</p>`;
    return;
  }
  bindUI();

  const last = persisted.last && puzzles.find((p) => p.id === persisted.last);
  const saved = last && persisted.puzzles[last.id];
  const resume = last && saved && !saved.done && hasProgress(last, saved);
  if (!resume) showPicker();

  // The digit atlas is drawn with Outfit, so wait (briefly) for the font.
  await Promise.race([
    document.fonts.load('600 64px "Outfit"').catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  try {
    scene = new CubeScene(els.stage, { onTap: onCellTap, fontFamily: '"Outfit", system-ui, sans-serif', reducedMotion });
    scene.spacing = settings.spacing;
    scene.setTheme(settings.theme);
    updateSafeArea();
    const ro = new ResizeObserver(() => updateSafeArea());
    for (const el of [els.topbar, els.hud, els.hero, els.picker, els.controls]) ro.observe(el);
    window.addEventListener("resize", updateSafeArea);
  } catch (err) {
    console.error(err);
    els.webglError.hidden = false;
  }

  // Test hook: ?debug exposes the live state for automated checks.
  if (new URLSearchParams(location.search).has("debug")) window.sudoku3d = { scene, get game() { return game; } };

  if (resume) openPuzzle(last.id);
  else if (ui.view === "picker") showcase();
  else if (game) attachScene();
}

/* -------------------- Views -------------------- */

function setView(view) {
  ui.view = view;
  els.body.classList.toggle("view-picker", view === "picker");
  els.body.classList.toggle("view-game", view === "game");
  els.picker.hidden = view !== "picker";
  els.controls.hidden = view !== "game";
  els.back.hidden = view !== "game";
  els.brand.hidden = view === "game";
  els.gameTitle.hidden = view !== "game";
  els.reset.hidden = view !== "game";
  els.solved.hidden = true;
  hideToast();
  updateSafeArea();
}

/**
 * The 3D stage fills the screen; the floating panels cover parts of it.
 * The camera frames the cube inside whatever is left uncovered.
 */
function updateSafeArea() {
  if (!scene) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  let top = els.topbar.getBoundingClientRect().bottom;
  let bottom = H;
  let right = W;
  const panel = ui.view === "game" ? els.controls : els.picker;
  const r = panel.getBoundingClientRect();
  const side = r.height > H * 0.6 && r.left > W * 0.3;
  if (side) right = r.left;
  else bottom = r.top;
  if (ui.view === "game") top = Math.max(top, els.hud.getBoundingClientRect().bottom);
  else if (!side) bottom = Math.min(bottom, els.hero.getBoundingClientRect().top);
  const pad = 8;
  scene.setSafeArea({ x: pad, y: top + pad, w: Math.max(80, right - 2 * pad), h: Math.max(80, bottom - top - 2 * pad) });
}

function showPicker() {
  if (game) {
    pauseTimer();
    persist();
  }
  setView("picker");
  renderPicker();
  showcase();
}

/** The picker shows a slowly turning cube of the selected family; the tesseract turns through 4D. */
function showcase() {
  if (!scene) return;
  const g = GROUPS[ui.group];
  const [kicker, line] = HERO[ui.group];
  els.hero.querySelector(".hero-kicker").textContent = kicker;
  els.hero.querySelector(".hero-line").textContent = line;
  const sample = puzzles.find((p) => groupOf(p) === ui.group);
  const cube = gridOf(g);
  // A solved cube: clues in white, the rest in the "filled in" colour.
  const given = digits(sample.puzzle);
  const solution = digits(sample.solution);
  scene.setPuzzle(g.size, { dims: g.dims });
  scene.update({
    values: solution,
    given,
    notes: new Uint16Array(cube.size),
    conflicts: new Set(),
    selected: null,
    mode: "cube",
    axis: g.dims === 4 ? 3 : 2,
    layer: 0,
    showcase: true,
  });
  scene.setShowcase(true);
  scene.resetView({ animate: false });
}

function renderPicker() {
  els.sizeTabs.forEach((t) => t.classList.toggle("active", t.dataset.group === ui.group));
  els.sizeTabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.group === ui.group)));
  const inGroup = puzzles.filter((p) => groupOf(p) === ui.group);
  const tiers = new Set(inGroup.map((p) => p.difficulty));
  if (ui.tier !== "all" && !tiers.has(ui.tier)) ui.tier = "all";
  els.tierTabs.forEach((t) => {
    t.hidden = t.dataset.tier !== "all" && !tiers.has(t.dataset.tier);
    t.classList.toggle("active", t.dataset.tier === ui.tier);
  });

  const list = inGroup.filter((p) => ui.tier === "all" || p.difficulty === ui.tier);
  els.list.innerHTML = list
    .map((p) => {
      const saved = persisted.puzzles[p.id];
      const done = saved?.done;
      const pct = saved && !done ? progressOf(p, saved) : 0;
      const label = `${GROUPS[groupOf(p)].label} ${puzzleNumber(p)}, ${TIER_LABEL[p.difficulty]}${done ? ", opgelost" : pct ? `, ${Math.round(pct * 100)}% ingevuld` : ""}`;
      return `<button class="pcard${done ? " done" : ""}" data-id="${p.id}" data-tier="${p.difficulty}" aria-label="${label}">
        <span class="pnum">${puzzleNumber(p)}</span>
        <span class="ptier">${TIER_LABEL[p.difficulty]}</span>
        ${pct > 0 ? `<span class="pbar"><i style="width:${Math.max(4, pct * 100).toFixed(1)}%"></i></span>` : ""}
      </button>`;
    })
    .join("");
}

/* -------------------- Game lifecycle -------------------- */

function openPuzzle(id) {
  const p = puzzles.find((x) => x.id === id);
  if (!p) return;
  const group = GROUPS[groupOf(p)];
  const cube = gridOf(group);
  const saved = persisted.puzzles[id];
  const given = digits(p.puzzle);
  const values = saved?.v ? digits(saved.v) : given.slice();
  const notes = new Uint16Array(cube.size);
  if (saved?.nt?.length === cube.size) notes.set(saved.nt);

  game = {
    id,
    n: p.size,
    dims: group.dims,
    cube,
    difficulty: p.difficulty,
    given,
    solution: digits(p.solution),
    values,
    notes,
    history: [],
    selected: null,
    notesMode: false,
    mode: saved?.view?.m || (p.size === 9 ? "layer" : "cube"),
    axis: saved?.view?.a ?? (group.dims === 4 ? 3 : 2),
    layer: saved?.view?.l ?? 0,
    marked: new Set(),
    completed: !!saved?.done,
    time: saved?.time || 0,
    startedAt: null,
  };
  persisted.last = id;
  ui.group = groupOf(p);
  persist();

  setView("game");
  els.gtName.textContent = `${group.label} ${puzzleNumber(p)}`;
  els.gtMeta.textContent = Array(group.dims).fill(p.size).join(" × ");
  configureToolbar();
  els.metaDiff.textContent = TIER_LABEL[p.difficulty];
  els.metaDiff.dataset.tier = p.difficulty;
  buildPad();
  if (scene) attachScene();
  else refresh();
  if (game.completed) showSolved(false);
  else resumeTimer();
}

function attachScene() {
  scene.setShowcase(false);
  scene.setPuzzle(game.n, { dims: game.dims });
  refresh();
  if (game.mode === "layer") scene.faceLayer({ tilt: true });
  else scene.resetView();
}

function resetPuzzle() {
  if (!game) return;
  game.values = game.given.slice();
  game.notes = new Uint16Array(game.cube.size);
  game.history = [];
  game.selected = null;
  game.marked.clear();
  game.completed = false;
  game.time = 0;
  game.startedAt = null;
  els.solved.hidden = true;
  resumeTimer();
  persist();
  refresh();
}

function nextPuzzle() {
  if (!game) return;
  const list = puzzles.filter((p) => groupOf(p) === ui.group);
  const idx = list.findIndex((p) => p.id === game.id);
  const next = list.slice(idx + 1).find((p) => !persisted.puzzles[p.id]?.done) || list[(idx + 1) % list.length];
  openPuzzle(next.id);
}

/* -------------------- Rendering -------------------- */

function refresh() {
  if (!game) return;
  const conflicts = findConflicts(game.cube, game.values);
  for (const i of game.marked) conflicts.add(i);
  const sel = game.selected;
  scene?.update({
    values: game.values,
    given: game.given,
    notes: game.notes,
    conflicts,
    selected: sel,
    mode: game.mode,
    axis: game.axis,
    layer: game.layer,
    highlight: sel != null ? game.values[sel] : 0,
  });
  updateToolbar();
  updatePad();
  updateHud();
}

/** Relabel the shared toolbar for a cube (3D) or a tesseract (4D). */
function configureToolbar() {
  els.controls.classList.toggle("dims-4", game.dims === 4);
  const labels = MODE_LABELS[game.dims];
  for (const b of els.modeSeg.querySelectorAll("button")) {
    const [text, aria] = labels[b.dataset.mode];
    b.querySelector("span").textContent = text;
    b.setAttribute("aria-label", aria);
    b.title = aria;
  }
  for (const b of els.axisSeg.querySelectorAll("button")) {
    const a = Number(b.dataset.axis);
    b.hidden = a >= game.dims;
    b.title = game.dims === 4 ? `4D-draai: spreid ${AXES[a]} over de vier kubussen` : `Lagen langs ${AXES[a]}`;
  }
  els.axisSeg.setAttribute("aria-label", game.dims === 4 ? "Welke as over de kubussen verdeeld is" : "Richting van de lagen");
  els.layerPrev.setAttribute("aria-label", game.dims === 4 ? "Vorige kubus" : "Vorige laag");
  els.layerNext.setAttribute("aria-label", game.dims === 4 ? "Volgende kubus" : "Volgende laag");
}

function updateToolbar() {
  for (const b of els.modeSeg.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.mode === game.mode));
  for (const b of els.axisSeg.querySelectorAll("button")) b.setAttribute("aria-checked", String(Number(b.dataset.axis) === game.axis));
  els.layerLabel.innerHTML = `<b>${game.layer + 1}</b><small>/${game.n}</small>`;
  els.layerLabel.classList.toggle("dim", game.mode !== "layer");
  els.notes.classList.toggle("on", game.notesMode);
  els.notes.setAttribute("aria-pressed", String(game.notesMode));
  els.controls.classList.toggle("notes-on", game.notesMode);
}

function buildPad() {
  const n = game.n;
  els.pad.style.setProperty("--n", n);
  els.pad.className = `pad n${n}`;
  els.pad.innerHTML = Array.from({ length: n }, (_, k) => `<button class="num" data-n="${k + 1}">${k + 1}<small></small></button>`).join("");
}

function updatePad() {
  const { n, values, cube } = game;
  const counts = new Array(n + 1).fill(0);
  for (const v of values) counts[v]++;
  const sel = game.selected;
  const blocked = new Set();
  if (settings.assist && sel != null && !values[sel]) {
    for (const p of cube.peers[sel]) if (values[p]) blocked.add(values[p]);
  }
  for (const btn of els.pad.children) {
    const d = Number(btn.dataset.n);
    const left = cube.size / n - counts[d];
    btn.classList.toggle("complete", left <= 0);
    btn.classList.toggle("blocked", blocked.has(d));
    btn.classList.toggle("noted", game.notesMode && sel != null && !values[sel] && !!(game.notes[sel] & (1 << (d - 1))));
    btn.querySelector("small").textContent = left > 0 ? left : "";
  }
}

function updateHud() {
  const total = game.given.reduce((r, v) => r + (v ? 0 : 1), 0);
  let filled = 0;
  for (let i = 0; i < game.values.length; i++) if (!game.given[i] && game.values[i]) filled++;
  els.metaProgress.textContent = `${filled} / ${total}`;
  updateTimer();
}

/* -------------------- Interaction -------------------- */

function onCellTap(cell) {
  if (ui.view !== "game" || !game || cell == null) return;
  selectCell(cell);
}

function selectCell(i) {
  game.selected = i;
  if (game.mode === "cube") game.layer = game.cube.coords[i][game.axis];
  refresh();
}

/** Brings a cell into view for the current mode (used by hints and keyboard). */
function revealCell(i) {
  const layer = game.cube.coords[i][game.axis];
  if (game.mode === "focus") return;
  if (game.layer !== layer) {
    game.layer = layer;
    refresh();
    if (game.mode === "layer") followCamera();
  }
}

function enterDigit(d) {
  if (!game || game.completed || game.selected == null || d > game.n) return;
  const i = game.selected;
  if (game.given[i]) return;
  pushHistory();
  game.marked.clear();
  const bit = 1 << (d - 1);
  if (game.notesMode) {
    game.values[i] = 0;
    game.notes[i] ^= bit;
  } else if (game.values[i] === d) {
    game.values[i] = 0;
  } else {
    game.values[i] = d;
    game.notes[i] = 0;
    for (const p of game.cube.peers[i]) game.notes[p] &= ~bit;
  }
  persist();
  refresh();
  checkComplete();
}

function eraseCell() {
  if (!game || game.completed || game.selected == null) return;
  const i = game.selected;
  if (game.given[i] || (!game.values[i] && !game.notes[i])) return;
  pushHistory();
  game.marked.clear();
  game.values[i] = 0;
  game.notes[i] = 0;
  persist();
  refresh();
}

function pushHistory() {
  game.history.push({ values: game.values.slice(), notes: game.notes.slice() });
  // Snapshots of the 6561-cell hypercube are large: keep fewer of them.
  if (game.history.length > (game.cube.size > 1000 ? 80 : 300)) game.history.shift();
}

function undo() {
  if (!game || game.completed || !game.history.length) return;
  const snap = game.history.pop();
  game.values = snap.values;
  game.notes = snap.notes;
  game.marked.clear();
  persist();
  refresh();
}

function toggleNotesMode() {
  if (!game) return;
  game.notesMode = !game.notesMode;
  updateToolbar();
  updatePad();
}

function autoNotes() {
  if (!game || game.completed) return;
  pushHistory();
  const cands = computeCandidates(game.cube, game.values);
  let count = 0;
  for (let i = 0; i < game.cube.size; i++) {
    if (game.values[i]) continue;
    game.notes[i] = cands[i];
    count++;
  }
  persist();
  refresh();
  showToast(`Opties ingevuld in <b>${count}</b> lege cellen.`);
}

function hint() {
  if (!game || game.completed) return;
  const wrong = [];
  for (let i = 0; i < game.cube.size; i++) if (game.values[i] && game.values[i] !== game.solution[i]) wrong.push(i);
  if (wrong.length) {
    game.marked = new Set(wrong);
    game.selected = wrong[0];
    revealCell(wrong[0]);
    refresh();
    showToast(wrong.length === 1 ? "Er staat <b>1</b> cijfer verkeerd. Het is rood gemarkeerd." : `Er staan <b>${wrong.length}</b> cijfers verkeerd. Ze zijn rood gemarkeerd.`, 4200);
    return;
  }
  const cands = computeCandidates(game.cube, game.values);
  let step = nextStep(game.cube, game.values, cands, 3);
  if (!step) {
    // Beyond the built-in techniques: reveal the solution for one empty cell.
    const empty = [...game.values.keys()].filter((i) => !game.values[i]);
    if (!empty.length) return;
    const cell = empty[Math.floor(Math.random() * empty.length)];
    step = { cell, digit: game.solution[cell], technique: "reveal" };
  }
  game.selected = step.cell;
  revealCell(step.cell);
  refresh();
  const d = `<b>${step.digit}</b>`;
  let msg;
  if (step.technique === "naked") msg = `In deze cel past alleen nog een ${d}.`;
  else if (step.technique === "hidden") msg = `De ${d} kan in deze ${houseName(step.house)} alleen hier.`;
  else msg = `Hier hoort een ${d}.`;
  showToast(msg, 4200);
}

function houseName(h) {
  const info = game.cube.houseInfo[h];
  return info.kind === "line" ? LINE_NAME[info.axis] : `blok (${AXES[info.plane[0]]}${AXES[info.plane[1]]}-vlak)`;
}

function setMode(mode) {
  if (!game || game.mode === mode) return;
  if (mode === "focus" && game.selected == null) game.selected = centerCell();
  game.mode = mode;
  if (game.selected != null && mode !== "focus") game.layer = game.cube.coords[game.selected][game.axis];
  persist();
  refresh();
  if (!scene) return;
  if (mode === "layer") {
    if (settings.autoFace) scene.faceLayer({ tilt: true });
    else scene.followLayer();
  } else {
    scene.resetView();
  }
}

function setAxis(axis) {
  if (!game || game.axis === axis || axis >= game.dims) return;
  game.axis = axis;
  if (game.selected != null) game.layer = game.cube.coords[game.selected][axis];
  persist();
  refresh();
  if (game.mode === "layer" && settings.autoFace) scene?.faceLayer({ tilt: true });
}

function stepLayer(delta) {
  if (!game) return;
  const layer = Math.max(0, Math.min(game.n - 1, game.layer + delta));
  const entering = game.mode !== "layer";
  if (!entering && layer === game.layer) return;
  game.mode = "layer";
  game.layer = layer;
  // Keep the selection on the same line through the cube.
  if (game.selected != null) {
    const c = [...game.cube.coords[game.selected]];
    c[game.axis] = layer;
    game.selected = game.cube.index(...c);
  }
  persist();
  refresh();
  if (entering && settings.autoFace) scene?.faceLayer({ tilt: true });
  else followCamera();
}

function followCamera() {
  scene?.followLayer();
}

function moveSelection(dx, dy, dz = 0) {
  if (!game) return;
  const { cube, axis, n } = game;
  if (game.selected == null) {
    const c = Array(game.dims).fill(0);
    c[axis] = game.layer;
    game.selected = cube.index(...c);
  } else if (game.dims === 4) {
    // Follow the visible slots of the turned tesseract: right, down, depth.
    const c = [...cube.coords[game.selected]];
    slotMap(axis).forEach(({ axis: a, sign }, slot) => {
      c[a] += sign * [dx, dy, dz][slot];
    });
    for (let k = 0; k < 4; k++) c[k] = Math.max(0, Math.min(n - 1, c[k]));
    game.selected = cube.index(...c);
  } else {
    const c = [...cube.coords[game.selected]];
    // Screen-relative movement for each face orientation.
    if (axis === 2) {
      c[0] += dx;
      c[1] += dy;
    } else if (axis === 1) {
      c[0] += dx;
      c[2] -= dy;
    } else {
      c[2] += dx;
      c[1] += dy;
    }
    for (let k = 0; k < 3; k++) c[k] = Math.max(0, Math.min(n - 1, c[k]));
    game.selected = cube.index(c[0], c[1], c[2]);
  }
  if (game.mode === "cube") game.layer = cube.coords[game.selected][axis];
  refresh();
}

function centerCell() {
  const m = (game.n - 1) >> 1;
  const c = Array(game.dims).fill(m);
  c[game.axis] = game.layer;
  return game.cube.index(...c);
}

function checkComplete() {
  if (game.completed) return;
  if (game.values.includes(0)) return;
  if (findConflicts(game.cube, game.values).size) return;
  game.completed = true;
  game.selected = null;
  game.mode = "cube";
  pauseTimer();
  persist();
  hideToast();
  refresh();
  scene?.resetView();
  scene?.celebrate();
  showSolved(true);
}

function showSolved(fresh) {
  els.solvedTime.textContent = fmtTime(game.time);
  els.solved.hidden = false;
  if (!fresh) els.solved.querySelector(".solved-card").style.animationDelay = "0s";
}

/* -------------------- Toast -------------------- */

let toastTimer = null;
function showToast(html, ms = 3000) {
  els.toast.innerHTML = html;
  els.toast.hidden = false;
  els.toast.style.animation = "none";
  void els.toast.offsetWidth;
  els.toast.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  els.toast.hidden = true;
}

/* -------------------- Timer -------------------- */

let tickHandle = null;

function liveTime() {
  if (!game) return 0;
  return game.time + (game.startedAt ? Math.floor((Date.now() - game.startedAt) / 1000) : 0);
}

function resumeTimer() {
  if (!game || game.completed || ui.view !== "game") return;
  if (!game.startedAt) game.startedAt = Date.now();
  clearInterval(tickHandle);
  tickHandle = setInterval(updateTimer, 1000);
  updateTimer();
}

function pauseTimer() {
  clearInterval(tickHandle);
  tickHandle = null;
  if (game?.startedAt) {
    game.time = liveTime();
    game.startedAt = null;
  }
}

function updateTimer() {
  if (game) els.metaTime.textContent = fmtTime(liveTime());
}

function fmtTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/* -------------------- Settings & theme -------------------- */

function applyThemeChrome() {
  document.documentElement.dataset.theme = settings.theme;
  els.themeMeta.setAttribute("content", THEME_COLOR[settings.theme] || THEME_COLOR.dark);
}

function setTheme(theme) {
  if (!THEMES[theme]) return;
  settings.theme = theme;
  applyThemeChrome();
  scene?.setTheme(theme);
  syncSettingsForm();
  persist();
}

function syncSettingsForm() {
  for (const b of els.themeSeg.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.theme === settings.theme));
  els.spacing.value = settings.spacing;
  els.autoFace.checked = settings.autoFace;
  els.assist.checked = settings.assist;
}

function openSheet(dialog) {
  if (dialog === els.settings) syncSettingsForm();
  dialog.showModal();
}

/* -------------------- Bindings -------------------- */

function bindUI() {
  els.back.addEventListener("click", showPicker);
  els.reset.addEventListener("click", () => {
    if (game && confirm("Puzzel opnieuw beginnen? Je voortgang wordt gewist.")) resetPuzzle();
  });
  els.helpBtn.addEventListener("click", () => openSheet(els.help));
  els.rulesCard.addEventListener("click", () => openSheet(els.help));
  els.settingsBtn.addEventListener("click", () => openSheet(els.settings));
  for (const dlg of [els.help, els.settings]) {
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  els.sizeTabs.forEach((t) =>
    t.addEventListener("click", () => {
      if (t.dataset.group === ui.group) return;
      ui.group = t.dataset.group;
      persist();
      renderPicker();
      showcase();
    }),
  );
  els.tierTabs.forEach((t) =>
    t.addEventListener("click", () => {
      ui.tier = t.dataset.tier;
      renderPicker();
    }),
  );
  els.list.addEventListener("click", (e) => {
    const card = e.target.closest(".pcard");
    if (card) openPuzzle(card.dataset.id);
  });

  els.viewReset.addEventListener("click", () => scene?.resetView());
  els.viewFace.addEventListener("click", () => {
    if (!game) return;
    if (game.mode !== "layer") setMode("layer");
    scene?.faceLayer({ tilt: false });
  });
  els.modeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setMode(b.dataset.mode);
  });
  els.axisSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setAxis(Number(b.dataset.axis));
  });
  els.layerPrev.addEventListener("click", () => stepLayer(-1));
  els.layerNext.addEventListener("click", () => stepLayer(1));

  els.pad.addEventListener("click", (e) => {
    const b = e.target.closest(".num");
    if (b) enterDigit(Number(b.dataset.n));
  });
  els.undo.addEventListener("click", undo);
  els.notes.addEventListener("click", toggleNotesMode);
  els.autonotes.addEventListener("click", autoNotes);
  els.hint.addEventListener("click", hint);
  els.erase.addEventListener("click", eraseCell);
  els.solvedList.addEventListener("click", showPicker);
  els.solvedNext.addEventListener("click", nextPuzzle);

  els.themeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) setTheme(b.dataset.theme);
  });
  els.spacing.addEventListener("input", () => {
    settings.spacing = Number(els.spacing.value);
    scene?.setSpacing(settings.spacing);
    persist();
  });
  els.autoFace.addEventListener("change", () => {
    settings.autoFace = els.autoFace.checked;
    persist();
  });
  els.assist.addEventListener("change", () => {
    settings.assist = els.assist.checked;
    if (game) updatePad();
    persist();
  });

  document.addEventListener("keydown", onKey);

  document.addEventListener("visibilitychange", () => {
    if (!game || game.completed) return;
    if (document.hidden) {
      pauseTimer();
      persist();
    } else if (ui.view === "game") resumeTimer();
  });
  window.addEventListener("pagehide", () => {
    if (game) {
      pauseTimer();
      persist();
    }
  });
}

function onKey(e) {
  if (ui.view !== "game" || !game || els.help.open || els.settings.open) return;
  const k = e.key;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k.toLowerCase() === "z") {
    e.preventDefault();
    undo();
    return;
  }
  if (mod || e.altKey) return;
  if (/^[1-9]$/.test(k)) enterDigit(Number(k));
  else if (k === "Backspace" || k === "Delete" || k === "0") eraseCell();
  else if (k === "ArrowLeft") moveSelection(-1, 0);
  else if (k === "ArrowRight") moveSelection(1, 0);
  else if (k === "ArrowUp" && e.shiftKey && game.dims === 4) moveSelection(0, 0, 1);
  else if (k === "ArrowDown" && e.shiftKey && game.dims === 4) moveSelection(0, 0, -1);
  else if (k === "ArrowUp") moveSelection(0, -1);
  else if (k === "ArrowDown") moveSelection(0, 1);
  else if (k === "[" || k === "PageUp" || k === ",") stepLayer(-1);
  else if (k === "]" || k === "PageDown" || k === ".") stepLayer(1);
  else if (/^[xyzw]$/i.test(k)) setAxis("xyzw".indexOf(k.toLowerCase()));
  else if (/^c$/i.test(k)) setMode("cube");
  else if (/^l$/i.test(k)) setMode("layer");
  else if (/^f$/i.test(k)) setMode("focus");
  else if (/^n$/i.test(k)) toggleNotesMode();
  else if (/^h$/i.test(k)) hint();
  else if (k === "Escape" && game.selected != null) {
    game.selected = null;
    refresh();
  } else return;
  e.preventDefault();
}

/* -------------------- Helpers -------------------- */

function digits(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) - 48;
  return out;
}

function puzzleNumber(p) {
  return p.id.split("-")[1];
}

function hasProgress(p, saved) {
  if (saved.nt?.some((m) => m)) return true;
  return saved.v && saved.v !== p.puzzle;
}

function progressOf(p, saved) {
  if (!saved.v) return 0;
  let total = 0;
  let filled = 0;
  for (let i = 0; i < p.puzzle.length; i++) {
    if (p.puzzle[i] !== "0") continue;
    total++;
    if (saved.v[i] !== "0") filled++;
  }
  return total ? filled / total : 0;
}

init();
