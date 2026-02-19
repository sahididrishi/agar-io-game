"use strict";
// ══════════════════════════════════════════════════════════════
//  AGAR.IO FFA — Interactive Game Engine
//  Based on AGAR_FFA_PRODUCTION_SPEC.md
// ══════════════════════════════════════════════════════════════

// ── Configuration Constants ──
const C = {
  WORLD: 14142,
  RADIUS_SCALE: 4.0,

  SPAWN_MASS: 32,
  SPAWN_PROTECT_MS: 3000,
  MAX_CELLS: 16,

  FOOD_MASS: 1,
  FOOD_TARGET: 1800,
  FOOD_PER_PLAYER: 35,
  FOOD_RADIUS: 6,

  VIRUS_COUNT: 28,
  VIRUS_MIN_MASS: 100,
  VIRUS_SPLIT_MASS: 133,
  VIRUS_FEED_MASS: 226,

  SPLIT_MIN_MASS: 36,
  SPLIT_BOOST: 9000,
  SPLIT_DECAY: 6.0,

  EJECT_MIN_MASS: 36,
  EJECT_COST: 16,
  EJECT_PROJ_MASS: 13,
  EJECT_SPEED: 8000,
  EJECT_COOLDOWN: 80,

  DECAY_RATE: 0.002,
  DECAY_MIN: 24,

  EAT_RATIO: 1.15,
  EAT_OVERLAP: 0.35,

  MERGE_BASE_MS: 30000,
  MERGE_PER_MASS: 18,

  SPEED_MIN: 200,
  SPEED_MAX: 3200,
  SPEED_EXP: 0.43,
  SPEED_FACTOR: 2800,

  BOT_COUNT: 30,
  LB_SIZE: 10,
};

// ── DOM Elements ──
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const dpr = Math.min(window.devicePixelRatio || 1, 2);

const startScreen = document.getElementById("startScreen");
const nameInput = document.getElementById("nameInput");
const playBtn = document.getElementById("playBtn");
const deathScreen = document.getElementById("deathScreen");
const respawnBtn = document.getElementById("respawnBtn");
const finalScoreEl = document.getElementById("finalScore");
const timeAliveEl = document.getElementById("timeAlive");
const topPositionEl = document.getElementById("topPosition");
const scoreValueEl = document.getElementById("scoreValue");
const lbListEl = document.getElementById("lbList");
const hudEl = document.getElementById("hud");
const minimapCanvas = document.getElementById("minimap");
const minimapCtx = minimapCanvas.getContext("2d");

// ── Utility Functions ──
function rad(mass) { return Math.sqrt(Math.max(0, mass)) * C.RADIUS_SCALE; }
function spd(mass) {
  return Math.max(C.SPEED_MIN, Math.min(C.SPEED_MAX,
    C.SPEED_FACTOR * Math.pow(mass, -C.SPEED_EXP)));
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function rand(a, b) { return a + Math.random() * (b - a); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function lerp(a, b, t) { return a + (b - a) * t; }
function normalize(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}
function clock(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function hueFromName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return h % 360;
}

// ── Spatial Hash Grid (for food) ──
const GRID_SIZE = 256;
const GRID_COLS = Math.ceil(C.WORLD / GRID_SIZE);
let foodGrid = new Map();

function gridKey(cx, cy) { return cy * GRID_COLS + cx; }

function rebuildFoodGrid() {
  foodGrid.clear();
  for (let i = 0; i < state.food.length; i++) {
    const f = state.food[i];
    const key = gridKey(Math.floor(f.x / GRID_SIZE), Math.floor(f.y / GRID_SIZE));
    let bucket = foodGrid.get(key);
    if (!bucket) { bucket = []; foodGrid.set(key, bucket); }
    bucket.push(i);
  }
}

function nearbyFoodIndices(x, y, r) {
  const result = [];
  const cx0 = Math.max(0, Math.floor((x - r) / GRID_SIZE));
  const cy0 = Math.max(0, Math.floor((y - r) / GRID_SIZE));
  const cx1 = Math.min(GRID_COLS - 1, Math.floor((x + r) / GRID_SIZE));
  const cy1 = Math.min(GRID_COLS - 1, Math.floor((y + r) / GRID_SIZE));
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const bucket = foodGrid.get(gridKey(cx, cy));
      if (bucket) for (let i = 0; i < bucket.length; i++) result.push(bucket[i]);
    }
  }
  return result;
}

// ── Entity IDs ──
let nextId = 1;
function newId() { return nextId++; }

// ── Bot Names ──
const BOT_NAMES = [
  "Shark", "Ghost", "Ninja", "Dragon", "Phoenix", "Viper", "Wolf", "Raven",
  "Titan", "Storm", "Blaze", "Shadow", "Frost", "Thunder", "Falcon", "Cobra",
  "Hawk", "Tiger", "Bear", "Eagle", "Panther", "Lion", "Raptor", "Hunter",
  "Phantom", "Bolt", "Vulture", "Striker", "Reaper", "Fang", "Savage", "Ace",
  "Wraith", "Claw", "Fury", "Venom", "Spike", "Blade", "Rocket", "Sniper",
];

// ── Game State ──
const state = {
  cells: [],      // all player/bot cells
  food: [],
  ejected: [],
  viruses: [],
  players: [],    // { id, name, hue, isBot, alive, target:{x,y}, ... }
  time: 0,
  tick: 0,
  gameStarted: false,
};

// Camera
const cam = { x: C.WORLD / 2, y: C.WORLD / 2, zoom: 0.06 };

// Input
let mouseScreenX = 0, mouseScreenY = 0;
let mouseWorldX = C.WORLD / 2, mouseWorldY = C.WORLD / 2;
let splitQueued = false, ejectQueued = false;

// Player ref
let player = null;
let bestRank = 999;

// Timing
let prevTs = 0, fpsFrames = 0, fpsTime = 0, fpsDisplay = 0;
const SIM_DT = 1 / 30; // 30Hz fixed step
let accumulator = 0;

// ── Create Entities ──
function makeFood() {
  return {
    id: newId(), x: rand(100, C.WORLD - 100), y: rand(100, C.WORLD - 100),
    mass: C.FOOD_MASS, hue: rand(0, 360), alive: true,
  };
}

function makeVirus(x, y) {
  return {
    id: newId(), x: x ?? rand(500, C.WORLD - 500), y: y ?? rand(500, C.WORLD - 500),
    mass: C.VIRUS_MIN_MASS, radius: rad(C.VIRUS_MIN_MASS), alive: true, fed: 0,
  };
}

function makeEjected(x, y, vx, vy, hue, ownerId) {
  return {
    id: newId(), x, y, vx, vy, mass: C.EJECT_PROJ_MASS,
    radius: rad(C.EJECT_PROJ_MASS), hue, ownerId,
    birthTime: state.time, alive: true,
  };
}

function makeCell(ownerId, x, y, mass) {
  return {
    id: newId(), ownerId, x, y,
    vx: 0, vy: 0,
    boostVx: 0, boostVy: 0,
    mass, radius: rad(mass),
    birthTime: state.time,
    canMergeTime: 0,
    alive: true,
  };
}

function makePlayer(name, isBot) {
  const id = newId();
  const hue = hueFromName(name + id);
  const p = {
    id, name, hue, isBot, alive: true,
    target: { x: C.WORLD / 2, y: C.WORLD / 2 },
    spawnTime: state.time,
    aiTimer: 0, aiState: "food",
    splitCooldown: 0, ejectCooldown: 0,
    wantSplit: false, wantEject: false,
    topRank: 999,
  };
  return p;
}

// ── Spawn Player ──
function spawnPlayer(p) {
  // Find safe spawn location (away from large cells)
  let sx, sy, safe;
  for (let attempt = 0; attempt < 50; attempt++) {
    sx = rand(500, C.WORLD - 500);
    sy = rand(500, C.WORLD - 500);
    safe = true;
    for (const cell of state.cells) {
      if (cell.mass > 200 && distSq({ x: sx, y: sy }, cell) < (cell.radius * 3) ** 2) {
        safe = false; break;
      }
    }
    if (safe) break;
  }
  const cell = makeCell(p.id, sx, sy, C.SPAWN_MASS);
  state.cells.push(cell);
  p.alive = true;
  p.spawnTime = state.time;
  p.target = { x: sx, y: sy };
  p.topRank = 999;
}

// ── Player Cells Helper ──
function cellsOf(playerId) {
  return state.cells.filter(c => c.alive && c.ownerId === playerId);
}

function totalMass(playerId) {
  let m = 0;
  for (const c of state.cells) if (c.alive && c.ownerId === playerId) m += c.mass;
  return m;
}

function centerOfMass(playerId) {
  let cx = 0, cy = 0, tm = 0;
  for (const c of state.cells) {
    if (c.alive && c.ownerId === playerId) {
      cx += c.x * c.mass; cy += c.y * c.mass; tm += c.mass;
    }
  }
  return tm > 0 ? { x: cx / tm, y: cy / tm } : { x: C.WORLD / 2, y: C.WORLD / 2 };
}

// ── Split ──
function performSplit(p) {
  const cells = cellsOf(p.id).sort((a, b) => b.mass - a.mass);
  const totalCells = cells.length;
  if (totalCells >= C.MAX_CELLS) return;

  for (const cell of cells) {
    if (cellsOf(p.id).length >= C.MAX_CELLS) break;
    if (cell.mass < C.SPLIT_MIN_MASS) continue;

    const dir = normalize(p.target.x - cell.x, p.target.y - cell.y);
    const halfMass = cell.mass / 2;

    cell.mass = halfMass;
    cell.radius = rad(cell.mass);

    const child = makeCell(p.id, cell.x + dir.x * cell.radius, cell.y + dir.y * cell.radius, halfMass);
    child.boostVx = dir.x * C.SPLIT_BOOST;
    child.boostVy = dir.y * C.SPLIT_BOOST;
    child.canMergeTime = state.time + (C.MERGE_BASE_MS + halfMass * C.MERGE_PER_MASS) / 1000;

    cell.canMergeTime = state.time + (C.MERGE_BASE_MS + halfMass * C.MERGE_PER_MASS) / 1000;

    state.cells.push(child);
  }
}

// ── Eject Mass ──
function performEject(p) {
  const cells = cellsOf(p.id);
  for (const cell of cells) {
    if (cell.mass < C.EJECT_MIN_MASS) continue;

    const dir = normalize(p.target.x - cell.x, p.target.y - cell.y);
    cell.mass -= C.EJECT_COST;
    cell.radius = rad(cell.mass);

    const ex = cell.x + dir.x * (cell.radius + 10);
    const ey = cell.y + dir.y * (cell.radius + 10);
    const ej = makeEjected(ex, ey, dir.x * C.EJECT_SPEED, dir.y * C.EJECT_SPEED,
      state.players.find(pp => pp.id === p.id)?.hue || 0, p.id);
    state.ejected.push(ej);
  }
}

// ── Virus Split (forced split when large cell hits virus) ──
function virusSplitCell(cell, virus) {
  const p = state.players.find(pp => pp.id === cell.ownerId);
  if (!p) return;
  const currentCells = cellsOf(p.id).length;
  if (currentCells >= C.MAX_CELLS) return;

  const pieces = Math.min(C.MAX_CELLS - currentCells, Math.floor(cell.mass / 36));
  if (pieces < 2) return;

  const massPerPiece = cell.mass / (pieces + 1);
  cell.mass = massPerPiece;
  cell.radius = rad(cell.mass);

  for (let i = 0; i < pieces; i++) {
    const angle = (Math.PI * 2 * i) / pieces + rand(-0.3, 0.3);
    const child = makeCell(p.id, cell.x, cell.y, massPerPiece);
    child.boostVx = Math.cos(angle) * C.SPLIT_BOOST * 0.8;
    child.boostVy = Math.sin(angle) * C.SPLIT_BOOST * 0.8;
    child.canMergeTime = state.time + (C.MERGE_BASE_MS + massPerPiece * C.MERGE_PER_MASS) / 1000;
    state.cells.push(child);
  }
}

// ── Movement ──
function moveCells(dt) {
  for (const cell of state.cells) {
    if (!cell.alive) continue;
    const p = state.players.find(pp => pp.id === cell.ownerId);
    if (!p) continue;

    const speed = spd(cell.mass);
    const dx = p.target.x - cell.x;
    const dy = p.target.y - cell.y;
    const d = Math.hypot(dx, dy) || 1;

    // Only move if cursor is outside the cell
    if (d > cell.radius * 0.15) {
      const dir = { x: dx / d, y: dy / d };
      // Scale speed by how far cursor is (smooth deceleration near target)
      const distFactor = Math.min(1, d / (cell.radius * 4));
      const desiredVx = dir.x * speed * distFactor;
      const desiredVy = dir.y * speed * distFactor;
      cell.vx = lerp(cell.vx, desiredVx, 0.14);
      cell.vy = lerp(cell.vy, desiredVy, 0.14);
    } else {
      cell.vx *= 0.75;
      cell.vy *= 0.75;
    }

    // Apply position
    cell.x += (cell.vx + cell.boostVx) * dt;
    cell.y += (cell.vy + cell.boostVy) * dt;

    // Decay split boost
    cell.boostVx *= Math.exp(-C.SPLIT_DECAY * dt);
    cell.boostVy *= Math.exp(-C.SPLIT_DECAY * dt);

    // World bounds
    cell.x = clamp(cell.x, cell.radius, C.WORLD - cell.radius);
    cell.y = clamp(cell.y, cell.radius, C.WORLD - cell.radius);
  }
}

// ── Same-owner cell pushing (no eating, soft collision) ──
function pushSameOwnerCells() {
  for (let i = 0; i < state.cells.length; i++) {
    const a = state.cells[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < state.cells.length; j++) {
      const b = state.cells[j];
      if (!b.alive || a.ownerId !== b.ownerId) continue;

      // Check if they can merge
      if (state.time >= a.canMergeTime && state.time >= b.canMergeTime) continue;

      const d = dist(a, b);
      const minDist = a.radius + b.radius;
      if (d < minDist && d > 0.1) {
        const overlap = minDist - d;
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        const push = overlap * 0.4;
        const totalM = a.mass + b.mass;
        const ratioA = b.mass / totalM;
        const ratioB = a.mass / totalM;
        a.x -= nx * push * ratioA;
        a.y -= ny * push * ratioA;
        b.x += nx * push * ratioB;
        b.y += ny * push * ratioB;
      }
    }
  }
}

// ── Merge same-owner cells ──
function mergeCells() {
  for (let i = 0; i < state.cells.length; i++) {
    const a = state.cells[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < state.cells.length; j++) {
      const b = state.cells[j];
      if (!b.alive || a.ownerId !== b.ownerId) continue;
      if (state.time < a.canMergeTime || state.time < b.canMergeTime) continue;

      const d = dist(a, b);
      if (d < Math.max(a.radius, b.radius)) {
        // Merge into larger
        if (a.mass >= b.mass) {
          a.mass += b.mass;
          a.radius = rad(a.mass);
          a.vx = (a.vx * a.mass + b.vx * b.mass) / (a.mass);
          a.vy = (a.vy * a.mass + b.vy * b.mass) / (a.mass);
          b.alive = false;
        } else {
          b.mass += a.mass;
          b.radius = rad(b.mass);
          a.alive = false;
        }
      }
    }
  }
}

// ── Food Collision ──
function eatFood() {
  rebuildFoodGrid();
  for (const cell of state.cells) {
    if (!cell.alive) continue;
    const nearby = nearbyFoodIndices(cell.x, cell.y, cell.radius + 20);
    for (const idx of nearby) {
      const f = state.food[idx];
      if (!f || !f.alive) continue;
      const d = dist(cell, f);
      if (d < cell.radius) {
        cell.mass += f.mass;
        cell.radius = rad(cell.mass);
        f.alive = false;
      }
    }
  }
  state.food = state.food.filter(f => f.alive);
}

// ── Ejected Mass Collision ──
function eatEjected() {
  for (const cell of state.cells) {
    if (!cell.alive) continue;
    for (const ej of state.ejected) {
      if (!ej.alive) continue;
      // Can't eat own ejected mass for 250ms
      if (ej.ownerId === cell.ownerId && state.time - ej.birthTime < 0.25) continue;
      if (cell.mass < ej.mass * C.EAT_RATIO) continue;

      const d = dist(cell, ej);
      if (d < cell.radius - ej.radius * C.EAT_OVERLAP) {
        cell.mass += ej.mass;
        cell.radius = rad(cell.mass);
        ej.alive = false;
      }
    }
  }
  state.ejected = state.ejected.filter(e => e.alive);
}

// ── Cell vs Cell Eat ──
function cellVsCellEat() {
  for (let i = 0; i < state.cells.length; i++) {
    const a = state.cells[i];
    if (!a.alive) continue;
    for (let j = 0; j < state.cells.length; j++) {
      if (i === j) continue;
      const b = state.cells[j];
      if (!b.alive) continue;
      if (a.ownerId === b.ownerId) continue; // same owner handled by merge

      // Spawn protection
      const pa = state.players.find(p => p.id === a.ownerId);
      const pb = state.players.find(p => p.id === b.ownerId);
      if (pa && state.time - pa.spawnTime < C.SPAWN_PROTECT_MS / 1000) continue;
      if (pb && state.time - pb.spawnTime < C.SPAWN_PROTECT_MS / 1000) continue;

      if (a.mass < b.mass * C.EAT_RATIO) continue;

      const d = dist(a, b);
      if (d < a.radius - b.radius * C.EAT_OVERLAP) {
        a.mass += b.mass;
        a.radius = rad(a.mass);
        b.alive = false;

        // Check if owner of b has any cells left
        if (pb) {
          const remaining = state.cells.filter(c => c.alive && c.ownerId === pb.id);
          if (remaining.length === 0) {
            pb.alive = false;
            // If it was the player
            if (pb === player) {
              showDeathScreen();
            } else if (pb.isBot) {
              // Respawn bot after delay
              setTimeout(() => respawnBot(pb), 3000 + rand(0, 4000));
            }
          }
        }
      }
    }
  }
}

// ── Virus Interactions ──
function virusInteractions() {
  for (const virus of state.viruses) {
    if (!virus.alive) continue;

    // Cell vs virus
    for (const cell of state.cells) {
      if (!cell.alive) continue;
      const d = dist(cell, virus);

      if (d < cell.radius + virus.radius * 0.5) {
        if (cell.mass >= C.VIRUS_SPLIT_MASS) {
          // Virus splits the cell!
          virusSplitCell(cell, virus);
          virus.alive = false;
          break;
        }
      }
    }

    // Ejected mass feeding virus
    for (const ej of state.ejected) {
      if (!ej.alive) continue;
      const d = dist(virus, ej);
      if (d < virus.radius + ej.radius) {
        virus.mass += ej.mass;
        virus.fed++;
        virus.radius = rad(virus.mass);
        ej.alive = false;

        // If fed enough, shoot new virus
        if (virus.mass >= C.VIRUS_FEED_MASS) {
          const dir = normalize(ej.vx, ej.vy);
          const newVirus = makeVirus(
            virus.x + dir.x * virus.radius * 2,
            virus.y + dir.y * virus.radius * 2
          );
          state.viruses.push(newVirus);
          virus.mass = C.VIRUS_MIN_MASS;
          virus.radius = rad(virus.mass);
          virus.fed = 0;
        }
      }
    }
  }
  state.viruses = state.viruses.filter(v => v.alive);
}

// ── Mass Decay ──
function massDecay(dt) {
  for (const cell of state.cells) {
    if (!cell.alive) continue;
    if (cell.mass > C.DECAY_MIN) {
      cell.mass -= cell.mass * C.DECAY_RATE * dt;
      cell.radius = rad(cell.mass);
    }
  }
}

// ── Ejected Mass Movement ──
function moveEjected(dt) {
  for (const ej of state.ejected) {
    if (!ej.alive) continue;
    ej.x += ej.vx * dt;
    ej.y += ej.vy * dt;
    ej.vx *= 0.92;
    ej.vy *= 0.92;
    ej.x = clamp(ej.x, 10, C.WORLD - 10);
    ej.y = clamp(ej.y, 10, C.WORLD - 10);
  }
}

// ── Spawning ──
function replenishFood() {
  const target = C.FOOD_TARGET + C.FOOD_PER_PLAYER * state.players.filter(p => p.alive).length;
  while (state.food.length < target) {
    state.food.push(makeFood());
  }
}

function replenishViruses() {
  while (state.viruses.filter(v => v.alive).length < C.VIRUS_COUNT) {
    state.viruses.push(makeVirus());
  }
}

// ── Bot AI ──
function updateBotAI(bot, dt) {
  bot.aiTimer -= dt;
  bot.splitCooldown = Math.max(0, bot.splitCooldown - dt);

  const myCells = cellsOf(bot.id);
  if (myCells.length === 0) return;

  const myCenter = centerOfMass(bot.id);
  const myTotalMass = totalMass(bot.id);

  if (bot.aiTimer <= 0) {
    bot.aiTimer = rand(0.3, 0.8);

    let bestFood = null, bestFoodDist = Infinity;
    let bestPrey = null, bestPreyDist = Infinity;
    let bestThreat = null, bestThreatDist = Infinity;

    // Find nearby food
    for (let i = 0; i < Math.min(state.food.length, 200); i++) {
      const f = state.food[Math.floor(rand(0, state.food.length))];
      if (!f.alive) continue;
      const d = distSq(myCenter, f);
      if (d < bestFoodDist) { bestFoodDist = d; bestFood = f; }
    }

    // Find nearby players
    for (const p2 of state.players) {
      if (p2.id === bot.id || !p2.alive) continue;
      const otherMass = totalMass(p2.id);
      const otherCenter = centerOfMass(p2.id);
      const d = distSq(myCenter, otherCenter);

      if (d < 2000 * 2000) {
        if (myTotalMass > otherMass * C.EAT_RATIO && d < bestPreyDist) {
          bestPreyDist = d; bestPrey = otherCenter;
        }
        if (otherMass > myTotalMass * C.EAT_RATIO && d < bestThreatDist) {
          bestThreatDist = d; bestThreat = otherCenter;
        }
      }
    }

    // Decision
    if (bestThreat && bestThreatDist < 1200 * 1200) {
      // Flee!
      const dx = myCenter.x - bestThreat.x;
      const dy = myCenter.y - bestThreat.y;
      const len = Math.hypot(dx, dy) || 1;
      bot.target.x = myCenter.x + (dx / len) * 800;
      bot.target.y = myCenter.y + (dy / len) * 800;
      bot.aiState = "flee";
    } else if (bestPrey && bestPreyDist < 1500 * 1500) {
      bot.target.x = bestPrey.x;
      bot.target.y = bestPrey.y;
      bot.aiState = "chase";

      // Maybe split if close enough and worth it
      if (bestPreyDist < 500 * 500 && bot.splitCooldown <= 0 && myCells.length < 4) {
        if (myCells[0] && myCells[0].mass > C.SPLIT_MIN_MASS * 2) {
          bot.wantSplit = true;
          bot.splitCooldown = 8;
        }
      }
    } else if (bestFood) {
      bot.target.x = bestFood.x;
      bot.target.y = bestFood.y;
      bot.aiState = "food";
    } else {
      // Wander
      bot.target.x = clamp(myCenter.x + rand(-600, 600), 500, C.WORLD - 500);
      bot.target.y = clamp(myCenter.y + rand(-600, 600), 500, C.WORLD - 500);
      bot.aiState = "wander";
    }

    // Keep within bounds
    bot.target.x = clamp(bot.target.x, 200, C.WORLD - 200);
    bot.target.y = clamp(bot.target.y, 200, C.WORLD - 200);
  }
}

function respawnBot(bot) {
  if (!bot || !state.gameStarted) return;
  bot.alive = true;
  spawnPlayer(bot);
}

// ── Simulation Tick ──
function simTick(dt) {
  state.time += dt;
  state.tick++;

  // Process player input
  if (player && player.alive) {
    player.target.x = mouseWorldX;
    player.target.y = mouseWorldY;
    if (splitQueued) { performSplit(player); splitQueued = false; }
    if (ejectQueued) { performEject(player); ejectQueued = false; }
  }

  // Bot AI
  for (const p of state.players) {
    if (!p.isBot || !p.alive) continue;
    updateBotAI(p, dt);
    if (p.wantSplit) { performSplit(p); p.wantSplit = false; }
    if (p.wantEject) { performEject(p); p.wantEject = false; }
  }

  // Movement
  moveCells(dt);
  moveEjected(dt);

  // Collisions
  pushSameOwnerCells();
  eatFood();
  eatEjected();
  cellVsCellEat();
  virusInteractions();

  // Economy
  massDecay(dt);
  mergeCells();

  // Spawning
  if (state.tick % 30 === 0) {
    replenishFood();
    replenishViruses();
  }

  // Cleanup dead cells
  state.cells = state.cells.filter(c => c.alive);
  state.ejected = state.ejected.filter(e => e.alive);
}

// ── Camera ──
function updateCamera(dt) {
  if (!player || !player.alive) return;

  const center = centerOfMass(player.id);
  const tm = totalMass(player.id);

  cam.x = lerp(cam.x, center.x, 0.12);
  cam.y = lerp(cam.y, center.y, 0.12);

  // Zoom out as mass increases — stay tighter for small cells
  const targetZoom = clamp(0.65 - Math.log(tm + 1) * 0.06, 0.06, 0.55);
  cam.zoom = lerp(cam.zoom, targetZoom, 0.06);
}

function screenToWorld(sx, sy) {
  const vw = canvas.width / dpr;
  const vh = canvas.height / dpr;
  return {
    x: (sx - vw / 2) / cam.zoom + cam.x,
    y: (sy - vh / 2) / cam.zoom + cam.y,
  };
}

// ── Rendering ──
function resizeCanvas() {
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}

function drawGrid() {
  ctx.strokeStyle = "rgba(40, 80, 120, 0.18)";
  ctx.lineWidth = 1;
  const gap = 300;
  const x0 = Math.floor(cam.x - (canvas.width / dpr / 2) / cam.zoom);
  const y0 = Math.floor(cam.y - (canvas.height / dpr / 2) / cam.zoom);
  const x1 = x0 + (canvas.width / dpr) / cam.zoom;
  const y1 = y0 + (canvas.height / dpr) / cam.zoom;

  const gx0 = Math.floor(x0 / gap) * gap;
  const gy0 = Math.floor(y0 / gap) * gap;

  for (let x = gx0; x <= x1; x += gap) {
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
  }
  for (let y = gy0; y <= y1; y += gap) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
}

function drawFood() {
  const vw = canvas.width / dpr, vh = canvas.height / dpr;
  const viewR = Math.max(vw, vh) / cam.zoom / 2 + 100;
  ctx.shadowBlur = 0;

  // Batch by hue
  const buckets = {};
  for (const f of state.food) {
    const dx = f.x - cam.x, dy = f.y - cam.y;
    if (Math.abs(dx) > viewR || Math.abs(dy) > viewR) continue;
    const key = Math.round(f.hue / 40) * 40;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(f);
  }

  for (const hKey in buckets) {
    const h = Number(hKey);
    ctx.fillStyle = `hsl(${h}, 80%, 60%)`;
    ctx.beginPath();
    for (const f of buckets[hKey]) {
      ctx.moveTo(f.x + C.FOOD_RADIUS, f.y);
      ctx.arc(f.x, f.y, C.FOOD_RADIUS, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function drawViruses() {
  for (const v of state.viruses) {
    const r = v.radius;
    const spikes = 18;

    // Spiky shape
    ctx.fillStyle = "rgba(40, 200, 80, 0.35)";
    ctx.strokeStyle = "rgba(40, 200, 80, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= spikes * 2; i++) {
      const angle = (Math.PI * 2 * i) / (spikes * 2);
      const spikeR = i % 2 === 0 ? r * 1.15 : r * 0.88;
      const px = v.x + Math.cos(angle) * spikeR;
      const py = v.y + Math.sin(angle) * spikeR;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawEjected() {
  for (const ej of state.ejected) {
    ctx.fillStyle = `hsl(${ej.hue}, 70%, 55%)`;
    ctx.beginPath();
    ctx.arc(ej.x, ej.y, ej.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCells() {
  // Sort by mass (smallest first, draw on bottom)
  const sorted = state.cells.filter(c => c.alive).sort((a, b) => a.mass - b.mass);

  for (const cell of sorted) {
    const p = state.players.find(pp => pp.id === cell.ownerId);
    if (!p) continue;
    const r = cell.radius;
    const hue = p.hue;
    const isPlayer = player && p.id === player.id;

    // Spawn protection visual
    const isProtected = state.time - p.spawnTime < C.SPAWN_PROTECT_MS / 1000;

    // Player glow effect
    if (isPlayer) {
      ctx.save();
      ctx.shadowColor = `hsla(${hue}, 80%, 60%, 0.6)`;
      ctx.shadowBlur = r * 0.6;
    }

    // Body gradient
    const grad = ctx.createRadialGradient(
      cell.x - r * 0.2, cell.y - r * 0.25, r * 0.1,
      cell.x, cell.y, r
    );
    grad.addColorStop(0, `hsla(${hue}, 85%, 65%, 0.95)`);
    grad.addColorStop(0.7, `hsla(${hue}, 75%, 45%, 0.95)`);
    grad.addColorStop(1, `hsla(${(hue + 25) % 360}, 70%, 30%, 0.95)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cell.x, cell.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (isPlayer) ctx.restore();

    // Outline
    ctx.lineWidth = isPlayer ? Math.max(3, r * 0.07) : Math.max(2, r * 0.04);
    ctx.strokeStyle = isProtected
      ? `rgba(120, 255, 180, ${0.5 + Math.sin(state.time * 8) * 0.3})`
      : isPlayer
        ? `hsla(${hue}, 90%, 85%, 0.7)`
        : `hsla(${hue}, 60%, 80%, 0.4)`;
    ctx.stroke();

    // Name
    if (r > 16) {
      const fontSize = clamp(Math.floor(r * 0.35), 10, 48);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${fontSize}px "Inter", "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Text stroke for readability
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = Math.max(2, fontSize * 0.12);
      ctx.lineJoin = "round";
      ctx.strokeText(p.name, cell.x, cell.y);
      ctx.fillText(p.name, cell.x, cell.y);

      // Mass number
      if (r > 30) {
        const massFontSize = clamp(Math.floor(r * 0.22), 8, 32);
        ctx.font = `${massFontSize}px "Inter", sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.strokeStyle = "rgba(0,0,0,0.4)";
        ctx.lineWidth = Math.max(1, massFontSize * 0.1);
        const massText = Math.round(cell.mass).toString();
        ctx.strokeText(massText, cell.x, cell.y + fontSize * 0.7);
        ctx.fillText(massText, cell.x, cell.y + fontSize * 0.7);
      }
    }
  }
}

function drawWorldBorder() {
  ctx.strokeStyle = "rgba(255, 80, 80, 0.5)";
  ctx.lineWidth = 8;
  ctx.strokeRect(0, 0, C.WORLD, C.WORLD);

  // Dark outside world
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  const big = 50000;
  ctx.fillRect(-big, -big, big + C.WORLD + big, big); // top
  ctx.fillRect(-big, C.WORLD, big + C.WORLD + big, big); // bottom
  ctx.fillRect(-big, 0, big, C.WORLD); // left
  ctx.fillRect(C.WORLD, 0, big, C.WORLD); // right
}

function drawMinimap() {
  const sz = 180;
  const mmDpr = Math.min(dpr, 2);
  minimapCanvas.width = sz * mmDpr;
  minimapCanvas.height = sz * mmDpr;
  minimapCanvas.style.width = sz + "px";
  minimapCanvas.style.height = sz + "px";
  minimapCtx.scale(mmDpr, mmDpr);

  // Background
  minimapCtx.fillStyle = "rgba(8, 16, 28, 0.85)";
  minimapCtx.fillRect(0, 0, sz, sz);

  const scale = sz / C.WORLD;

  // Food (tiny dots)
  minimapCtx.fillStyle = "rgba(120, 180, 80, 0.3)";
  for (let i = 0; i < state.food.length; i += 20) {
    const f = state.food[i];
    minimapCtx.fillRect(f.x * scale, f.y * scale, 1, 1);
  }

  // Viruses
  minimapCtx.fillStyle = "rgba(40, 200, 80, 0.6)";
  for (const v of state.viruses) {
    minimapCtx.beginPath();
    minimapCtx.arc(v.x * scale, v.y * scale, 2, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // All players
  for (const p of state.players) {
    if (!p.alive) continue;
    const center = centerOfMass(p.id);
    const mass = totalMass(p.id);
    const r = clamp(Math.sqrt(mass) * scale * 0.3, 1.5, 6);
    minimapCtx.fillStyle = p === player
      ? "rgba(255, 255, 255, 1)"
      : `hsla(${p.hue}, 70%, 55%, 0.75)`;
    minimapCtx.beginPath();
    minimapCtx.arc(center.x * scale, center.y * scale, r, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // Viewport rect
  const vw = canvas.width / dpr / cam.zoom;
  const vh = canvas.height / dpr / cam.zoom;
  minimapCtx.strokeStyle = "rgba(255, 200, 60, 0.8)";
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(
    (cam.x - vw / 2) * scale, (cam.y - vh / 2) * scale,
    vw * scale, vh * scale
  );

  // Border
  minimapCtx.strokeStyle = "rgba(100, 180, 255, 0.4)";
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(0, 0, sz, sz);

  minimapCtx.setTransform(1, 0, 0, 1, 0, 0);
}

function render() {
  const vw = canvas.width / dpr;
  const vh = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(0, 0, vw, vh);

  // World transform
  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  drawGrid();
  drawWorldBorder();
  drawFood();
  drawEjected();
  drawViruses();
  drawCells();

  ctx.restore();

  // FPS
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = '12px "JetBrains Mono", monospace';
  ctx.textAlign = "right";
  ctx.fillText(fpsDisplay + " FPS", vw - 12, vh - 12);
}

// ── HUD ──
let hudTimer = 0;

function updateHUD() {
  if (!player) return;
  const tm = Math.round(totalMass(player.id));
  scoreValueEl.textContent = tm.toLocaleString();

  // Leaderboard
  const ranked = state.players
    .filter(p => p.alive)
    .map(p => ({ ...p, totalMass: totalMass(p.id) }))
    .sort((a, b) => b.totalMass - a.totalMass)
    .slice(0, C.LB_SIZE);

  // Track best rank
  if (player.alive) {
    const myRank = ranked.findIndex(r => r.id === player.id) + 1;
    if (myRank > 0 && myRank < bestRank) bestRank = myRank;
  }

  lbListEl.innerHTML = ranked.map((r, i) => {
    const isMe = r.id === player.id;
    return `<li class="${isMe ? "me" : ""}">${i + 1}. ${r.name} — ${Math.round(r.totalMass).toLocaleString()}</li>`;
  }).join("");
}

// ── Death Screen ──
function showDeathScreen() {
  if (!player) return;
  const survivedSec = state.time - player.spawnTime;
  finalScoreEl.textContent = Math.round(totalMass(player.id) || 0).toLocaleString();
  timeAliveEl.textContent = clock(survivedSec);
  topPositionEl.textContent = bestRank > 100 ? "-" : "#" + bestRank;
  deathScreen.classList.remove("hidden");
  hudEl.classList.add("hidden");
}

function hideDeathScreen() {
  deathScreen.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

// ── Game Loop ──
function tick(ts) {
  const rawDt = prevTs ? Math.min(0.1, (ts - prevTs) / 1000) : SIM_DT;
  prevTs = ts;

  // FPS counter
  fpsFrames++;
  fpsTime += rawDt;
  if (fpsTime >= 0.5) {
    fpsDisplay = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0; fpsTime = 0;
  }

  if (state.gameStarted) {
    // Update mouse world position BEFORE sim tick
    const world = screenToWorld(mouseScreenX, mouseScreenY);
    mouseWorldX = world.x;
    mouseWorldY = world.y;

    // Fixed timestep simulation
    accumulator += rawDt;
    while (accumulator >= SIM_DT) {
      simTick(SIM_DT);
      accumulator -= SIM_DT;
    }

    updateCamera(rawDt);

    // HUD update at ~5Hz
    hudTimer += rawDt;
    if (hudTimer > 0.2) { updateHUD(); hudTimer = 0; }
  }

  render();
  requestAnimationFrame(tick);
}

// ── Input Handlers ──
function bindInput() {
  // Use document-level listener so HUD overlay doesn't block mouse events
  document.addEventListener("mousemove", e => {
    mouseScreenX = e.clientX;
    mouseScreenY = e.clientY;
    // Update CSS custom property for cursor circle
    document.body.style.setProperty("--mx", e.clientX + "px");
    document.body.style.setProperty("--my", e.clientY + "px");
  });

  document.addEventListener("touchmove", e => {
    if (state.gameStarted) e.preventDefault();
    const touch = e.touches[0];
    mouseScreenX = touch.clientX;
    mouseScreenY = touch.clientY;
  }, { passive: false });

  window.addEventListener("keydown", e => {
    if (!player || !player.alive) return;
    if (e.code === "Space") { e.preventDefault(); splitQueued = true; }
    if (e.code === "KeyW" && document.activeElement !== nameInput) { e.preventDefault(); ejectQueued = true; }
  });

  window.addEventListener("resize", resizeCanvas);

  // Start game
  playBtn.addEventListener("click", startGame);
  nameInput.addEventListener("keydown", e => { if (e.key === "Enter") startGame(); });
  respawnBtn.addEventListener("click", respawnPlayer);
}

function startGame() {
  const name = nameInput.value.trim() || "Player";

  if (!state.gameStarted) {
    initWorld();
  }

  // Create player
  player = makePlayer(name, false);
  state.players.push(player);
  spawnPlayer(player);
  bestRank = 999;

  startScreen.classList.add("hidden");
  hudEl.classList.remove("hidden");
  state.gameStarted = true;
}

function respawnPlayer() {
  if (!player) return;
  hideDeathScreen();

  // Re-create player
  const name = player.name;
  player = makePlayer(name, false);
  state.players.push(player);
  spawnPlayer(player);
  bestRank = 999;
}

// ── World Initialization ──
function initWorld() {
  state.cells = [];
  state.food = [];
  state.ejected = [];
  state.viruses = [];
  state.players = [];
  state.time = 0;
  state.tick = 0;

  // Spawn food
  for (let i = 0; i < C.FOOD_TARGET; i++) {
    state.food.push(makeFood());
  }

  // Spawn viruses
  for (let i = 0; i < C.VIRUS_COUNT; i++) {
    state.viruses.push(makeVirus());
  }

  // Spawn bots
  for (let i = 0; i < C.BOT_COUNT; i++) {
    const bot = makePlayer(BOT_NAMES[i % BOT_NAMES.length], true);
    state.players.push(bot);
    spawnPlayer(bot);
  }
}

// ── Boot ──
function boot() {
  resizeCanvas();
  bindInput();
  nameInput.focus();
  requestAnimationFrame(tick);
}

boot();
