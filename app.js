"use strict";
// ══════════════════════════════════════════════════════════════
//  SNAKE.IO "DREAM" — Interactive Game Engine
//  Premium continuous-movement snake implementation 
// ══════════════════════════════════════════════════════════════

// ── Configuration Constants ──
const C = {
  WORLD: 14142,
  FOOD_TARGET: 2500,
  FOOD_MASS: 2,
  SPAWN_MASS: 25,
  BOT_COUNT: 45,

  BASE_SPEED: 420,
  BOOST_SPEED: 750,
  PHASE_SPEED: 950,
  TURN_SPEED: 3.5,

  PHASE_DURATION: 1.2,
  PHASE_COOLDOWN: 8.0,

  MIN_MASS_BOOST: 30,
  BOOST_COST_RATE: 10, // Mass consumed per second holding boost

  SEGMENT_DIST: 20, // Distance between recorded history points
  SPAWN_PROTECT: 3.0,
  LB_SIZE: 10
};

// ── Global State ──
const state = {
  snakes: [],
  food: [],
  dropped: [],
  time: 0,
  gameStarted: false,
};

let myId = 0;
let nextId = 1;

// Input State
let mouseScreenX = 0, mouseScreenY = 0;
let mouseWorldX = C.WORLD / 2, mouseWorldY = C.WORLD / 2;
let isBoosting = false, phaseQueued = false;

// Particles & Effects
const particles = [];
const floatingTexts = [];
let screenShake = { x: 0, y: 0, magnitude: 0 };

// Player ref
let player = null;
let bestRank = 999;

// Timing
let prevTs = 0, fpsFrames = 0, fpsTime = 0, fpsDisplay = 0;
const SIM_DT = 1 / 30; // 30Hz fixed step
let accumulator = 0;

// ── Math & Helpers ──
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function distSq(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
function dist(a, b) { return Math.sqrt(distSq(a, b)); }
function rand(min, max) { return Math.random() * (max - min) + min; }

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function getThickness(mass) {
  return clamp(15 + Math.sqrt(mass) * 1.8, 15, 150);
}

function getTargetLength(mass) {
  return clamp(8 + Math.floor(mass / 4), 8, 300);
}

const names = ["Shadow", "Viper", "Ghost", "Titan", "Slither", "Neon", "Joker", "Apex", "Nova", "Cosmos"];

// ── Particle System ──
function spawnParticles(x, y, count, colorHue, speedMult = 1, lifeMult = 1) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (Math.random() * 400 + 100) * speedMult;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hue: colorHue + (Math.random() * 20 - 10),
      alpha: 1,
      life: (0.5 + Math.random() * 0.5) * lifeMult,
      maxLife: (0.5 + Math.random() * 0.5) * lifeMult,
      radius: Math.random() * 5 + 2
    });
  }
}

function spawnFloatingText(x, y, text, color, scale = 1) {
  floatingTexts.push({
    x, y, text, color, scale,
    life: 1.0, maxLife: 1.0,
    vy: -150 - Math.random() * 50
  });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      if (i !== particles.length - 1) particles[i] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-4.0 * dt);
    p.vy *= Math.exp(-4.0 * dt);
    p.alpha = Math.pow(Math.max(0, p.life / p.maxLife), 1.5);
  }

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    if (ft.life <= 0) {
      if (i !== floatingTexts.length - 1) floatingTexts[i] = floatingTexts[floatingTexts.length - 1];
      floatingTexts.pop();
      continue;
    }
    ft.y += ft.vy * dt;
    ft.vy *= Math.exp(-2.0 * dt);
  }

  // Screen shake decay
  if (screenShake.magnitude > 0.1) {
    screenShake.magnitude = lerp(screenShake.magnitude, 0, 0.1);
    screenShake.x = (Math.random() - 0.5) * screenShake.magnitude * 2;
    screenShake.y = (Math.random() - 0.5) * screenShake.magnitude * 2;
  } else {
    screenShake.magnitude = 0;
    screenShake.x = 0;
    screenShake.y = 0;
  }
}

// ── Progression Levels ──
function getPlayerLevel(mass) {
  if (mass < 100) return { level: 1, title: "Hatchling" };
  if (mass < 300) return { level: 2, title: "Viper" };
  if (mass < 1000) return { level: 3, title: "Hunter" };
  if (mass < 2500) return { level: 4, title: "Predator" };
  if (mass < 5000) return { level: 5, title: "Anaconda" };
  if (mass < 10000) return { level: 6, title: "Leviathan" };
  return { level: 7, title: "World Serpent" };
}

// ── Create Entities ──
function makeFood() {
  return {
    x: rand(100, C.WORLD - 100),
    y: rand(100, C.WORLD - 100),
    hue: Math.floor(rand(0, 360)),
    mass: C.FOOD_MASS,
    alive: true
  };
}

function spawnSnake(isBot, playerName = "") {
  const x = rand(2000, C.WORLD - 2000);
  const y = rand(2000, C.WORLD - 2000);
  const angle = rand(0, Math.PI * 2);

  const id = nextId++;
  const s = {
    id,
    isBot,
    name: isBot ? names[Math.floor(Math.random() * names.length)] : playerName,
    hue: Math.floor(rand(0, 360)),
    mass: C.SPAWN_MASS,
    alive: true,
    spawnTime: state.time,

    head: { x, y },
    angle: angle,
    targetAngle: angle,

    // Mechanics
    points: [{ x, y }],
    boosting: false,
    boostAccumulator: 0,

    // Ghost dash ability
    phaseEndTime: 0,
    phaseCooldownTime: 0,

    // Bot memory
    botTarget: null,
    botActionTs: 0
  };

  if (!isBot) {
    myId = id;
    player = s;
  }

  state.snakes.push(s);
}

// ── Death & Loot ──
function dropLoot(snake, killerId = null) {
  // Convert mass to high value drops along the body
  const dropCount = Math.min(snake.points.length, Math.floor(snake.mass / 5));
  if (dropCount <= 0) return;

  const massPerDrop = snake.mass / dropCount;
  const step = Math.max(1, Math.floor(snake.points.length / dropCount));

  for (let i = 0; i < snake.points.length; i += step) {
    const pt = snake.points[i];
    // Add scatter
    const scatterAngle = rand(0, Math.PI * 2);
    const scatterDist = rand(0, getThickness(snake.mass));

    state.dropped.push({
      x: pt.x + Math.cos(scatterAngle) * scatterDist,
      y: pt.y + Math.sin(scatterAngle) * scatterDist,
      hue: snake.hue,
      mass: massPerDrop * 0.8, // 80% conversion efficiency
      alive: true,
      magnetTarget: killerId,
      magnetTime: state.time + 3.0 // Magnetic for 3 seconds
    });
  }
}

// ── Movement & Core update ──
function moveSnakes(dt) {
  for (const s of state.snakes) {
    if (!s.alive) continue;

    // Logic: Turning
    const diff = angleDiff(s.angle, s.targetAngle);
    const currentTurnSpeed = C.TURN_SPEED * (s.boosting ? 1.5 : 1) * clamp(100 / s.mass, 0.4, 1.2);

    if (Math.abs(diff) < currentTurnSpeed * dt) {
      s.angle = s.targetAngle;
    } else {
      s.angle += Math.sign(diff) * currentTurnSpeed * dt;
    }

    // Logic: Speed & Phase
    let speed = C.BASE_SPEED;
    const isPhasing = state.time < s.phaseEndTime;

    if (isPhasing) {
      speed = C.PHASE_SPEED;
      s.boosting = false; // Phase overrides manual boost
    } else if (s.boosting && s.mass > C.MIN_MASS_BOOST) {
      speed = C.BOOST_SPEED;
      // Consume mass
      const consumed = C.BOOST_COST_RATE * dt;
      s.mass -= consumed;
      s.boostAccumulator += consumed;
      if (s.boostAccumulator >= C.FOOD_MASS * 2) {
        // Drop a trail food
        s.boostAccumulator = 0;
        const tail = s.points[s.points.length - 1];
        if (tail) {
          state.dropped.push({
            x: tail.x + rand(-5, 5), y: tail.y + rand(-5, 5),
            hue: s.hue, mass: C.FOOD_MASS * 2, alive: true,
            magnetTarget: null, magnetTime: 0
          });
        }
      }
    } else {
      s.boosting = false;
    }

    // Move Head
    s.head.x += Math.cos(s.angle) * speed * dt;
    s.head.y += Math.sin(s.angle) * speed * dt;

    // Bounds check
    if (s.head.x < 0 || s.head.x > C.WORLD || s.head.y < 0 || s.head.y > C.WORLD) {
      s.alive = false;
      dropLoot(s);
      if (s === player) screenShake.magnitude += 20;
      continue;
    }

    // Add point to history
    const targetPointsCount = getTargetLength(s.mass);
    const lastPt = s.points[0];
    if (distSq(s.head, lastPt) >= C.SEGMENT_DIST ** 2) {
      s.points.unshift({ x: s.head.x, y: s.head.y });
      while (s.points.length > targetPointsCount) {
        s.points.pop();
      }
    }

    // Passive growth/decay
    if (!s.boosting && s.mass > C.SPAWN_MASS) s.mass -= s.mass * 0.001 * dt; // slow decay
  }
}

// ── Collision ──
function checkCollisions() {
  // 1. Eat Food & Loot
  for (const s of state.snakes) {
    if (!s.alive) continue;
    const r = getThickness(s.mass) * 0.8;
    const rSq = r * r;

    // Standard food
    for (const f of state.food) {
      if (!f.alive) continue;
      if (distSq(s.head, f) < rSq) {
        s.mass += f.mass;
        f.alive = false;
      }
    }

    // Dropped Loot (Magnetic logic handled in a separate pass for movement)
    for (const d of state.dropped) {
      if (!d.alive) continue;
      if (distSq(s.head, d) < rSq * 1.5) { // slightly larger pickup radius for loot
        s.mass += d.mass;
        d.alive = false;
        spawnParticles(d.x, d.y, 4, s.hue, 0.6, 0.5);
        if (s === player) {
          spawnFloatingText(d.x, d.y, `+${Math.round(d.mass)}`, "#ffbe0b", clamp(d.mass / 10, 0.8, 2.0));
        }
      }
    }
  }

  // 2. Head to Body Collisions (The Snake.io mechanic)
  for (let i = 0; i < state.snakes.length; i++) {
    const A = state.snakes[i];
    if (!A.alive) continue;
    if (state.time < A.phaseEndTime) continue; // Phasing snakes are invincible to crashes
    if (state.time - A.spawnTime < C.SPAWN_PROTECT) continue;

    const AThickness = getThickness(A.mass);

    for (let j = 0; j < state.snakes.length; j++) {
      if (i === j) continue;
      const B = state.snakes[j];
      if (!B.alive) continue;

      const BThickness = getThickness(B.mass);
      const hitDist = (AThickness * 0.45) + (BThickness * 0.45);
      const hitDistSq = hitDist * hitDist;

      // Broad phase
      if (Math.abs(A.head.x - B.head.x) > 1500 || Math.abs(A.head.y - B.head.y) > 1500) continue;

      // Check A head vs B body points (skip first 2 points to avoid weird head-to-head ties and allow tight cutoffs)
      let crashed = false;
      for (let k = 2; k < B.points.length; k++) {
        const pt = B.points[k];
        if (distSq(A.head, pt) < hitDistSq) {
          crashed = true;
          break;
        }
      }

      if (crashed) {
        // A crashed into B! B gets the magnetic credit
        A.alive = false;
        dropLoot(A, B.id);

        spawnParticles(A.head.x, A.head.y, 40, A.hue, 3.0, 1.5);
        if (A === player || B === player) {
          screenShake.magnitude += 25; // Massive shake
          if (B === player) {
            spawnFloatingText(A.head.x, A.head.y, "KILLED!", "#ff1f5a", 2.0);
          }
        }
        break; // A is dead, stop checking
      }
    }
  }
}

function updateMagneticLoot(dt) {
  for (const d of state.dropped) {
    if (!d.alive) continue;
    if (d.magnetTarget !== null && state.time < d.magnetTime) {
      const killer = state.snakes.find(s => s.id === d.magnetTarget);
      if (killer && killer.alive) {
        // Accelerate toward killer
        const dirX = killer.head.x - d.x;
        const dirY = killer.head.y - d.y;
        const distToK = Math.hypot(dirX, dirY) || 1;

        // Massive speed boost toward killer
        const magSpeed = 800;
        d.x += (dirX / distToK) * magSpeed * dt;
        d.y += (dirY / distToK) * magSpeed * dt;
      }
    }
  }
}

// ── Bot AI ──
function updateBotAI(dt) {
  for (const bot of state.snakes) {
    if (!bot.isBot || !bot.alive) continue;

    // Occasionally update targets
    if (state.time > bot.botActionTs) {
      bot.botActionTs = state.time + rand(0.5, 2.0);

      // Find nearest loot or food
      let bestT = null;
      let minD = 999999;

      // Prioritize large dropped loot
      for (const d of state.dropped) {
        if (!d.alive || (d.magnetTarget && d.magnetTarget !== bot.id)) continue;
        const dsq = distSq(bot.head, d);
        if (dsq < 1000 * 1000 && dsq < minD) {
          minD = dsq;
          bestT = d;
        }
      }

      if (!bestT) {
        for (const f of state.food) {
          if (!f.alive) continue;
          const dsq = distSq(bot.head, f);
          if (dsq < 800 * 800 && dsq < minD) {
            minD = dsq;
            bestT = f;
          }
        }
      }

      if (bestT) {
        bot.targetAngle = Math.atan2(bestT.y - bot.head.y, bestT.x - bot.head.x);
        // Boost randomly if targeting big loot
        bot.boosting = bot.mass > 50 && bestT.mass > 10 && rand(0, 1) > 0.6;
      } else {
        // Wander
        bot.targetAngle += rand(-1.0, 1.0);
        bot.boosting = false;
      }
    }

    // Hazard avoidance (Look ahead for snake bodies or walls)
    const lookDist = getThickness(bot.mass) * 3 + 200;
    const px = bot.head.x + Math.cos(bot.angle) * lookDist;
    const py = bot.head.y + Math.sin(bot.angle) * lookDist;

    // Wall avoid
    if (px < 0 || px > C.WORLD || py < 0 || py > C.WORLD) {
      // Turn towards center
      const centerAngle = Math.atan2(C.WORLD / 2 - bot.head.y, C.WORLD / 2 - bot.head.x);
      bot.targetAngle = centerAngle;
      bot.botActionTs = state.time + 1.0;
    } else {
      // Body avoid
      let imminentDanger = false;
      for (const other of state.snakes) {
        if (other === bot) continue;
        for (let k = 0; k < other.points.length; k += 3) {
          const pt = other.points[k];
          if (distSq({ x: px, y: py }, pt) < (getThickness(other.mass) * 1.5) ** 2) {
            imminentDanger = true; break;
          }
        }
        if (imminentDanger) break;
      }

      if (imminentDanger) {
        bot.targetAngle += Math.PI / 2; // Swerve hard
        bot.botActionTs = state.time + 0.5;
        bot.boosting = bot.mass > 50; // Panic boost
      }
    }
  }
}

function respawnBots() {
  const activeBots = state.snakes.filter(s => s.isBot && s.alive).length;
  for (let i = activeBots; i < C.BOT_COUNT; i++) {
    spawnSnake(true);
  }
}

// ── Simulation Tick ──
function simTick(dt) {
  state.time += dt;
  if (!state.gameStarted) return;

  if (player && player.alive) {
    player.targetAngle = Math.atan2(mouseWorldY - player.head.y, mouseWorldX - player.head.x);
    player.boosting = isBoosting;

    if (phaseQueued) {
      phaseQueued = false;
      if (state.time > player.phaseCooldownTime && player.mass > 80) {
        player.phaseEndTime = state.time + C.PHASE_DURATION;
        player.phaseCooldownTime = state.time + C.PHASE_COOLDOWN;
        player.mass -= 30; // Cost of phase shift
        screenShake.magnitude += 10;
        spawnFloatingText(player.head.x, player.head.y, "PHASE SHIFT!", "#00e5ff", 1.8);
      }
    }
  }

  updateBotAI(dt);
  moveSnakes(dt);
  updateMagneticLoot(dt);
  checkCollisions();

  // Cleanup arrays
  state.snakes = state.snakes.filter(s => s.alive || s === player);
  state.food = state.food.filter(f => f.alive);
  state.dropped = state.dropped.filter(d => d.alive);

  // Maintain environment
  while (state.food.length < C.FOOD_TARGET) state.food.push(makeFood());
  respawnBots();
}

// ── Rendering & UI ──
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const dpr = window.devicePixelRatio || 1;

const cam = { x: C.WORLD / 2, y: C.WORLD / 2, zoom: 0.15 };

const startScreenEl = document.getElementById("startScreen");
const deathScreenEl = document.getElementById("deathScreen");
const nameInputEl = document.getElementById("nameInput");
const timeAliveEl = document.getElementById("timeAlive");
const topPositionEl = document.getElementById("topPosition");
const scoreValueEl = document.getElementById("scoreValue");
const scoreLevelEl = document.getElementById("scoreLevel");
const lbListEl = document.getElementById("lbList");
const hudEl = document.getElementById("hud");
const minimapCanvas = document.getElementById("minimap");
const minimapCtx = minimapCanvas.getContext("2d");

function resizeCanvas() {
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}

function updateCamera(dt) {
  if (!player || !player.alive) return;

  const targetX = player.head.x + Math.cos(player.angle) * 150; // Camera leads the head slightly
  const targetY = player.head.y + Math.sin(player.angle) * 150;

  cam.x = lerp(cam.x, targetX, 0.1);
  cam.y = lerp(cam.y, targetY, 0.1);

  cam.x += screenShake.x;
  cam.y += screenShake.y;

  // Zoom out based on length
  const targetZoom = clamp(0.7 - Math.log(getTargetLength(player.mass) + 1) * 0.08, 0.08, 0.6);
  cam.zoom += (targetZoom - cam.zoom) * 0.05;
}

function screenToWorld(sx, sy) {
  const vw = canvas.width / dpr, vh = canvas.height / dpr;
  return {
    x: (sx - vw / 2) / cam.zoom + cam.x,
    y: (sy - vh / 2) / cam.zoom + cam.y,
  };
}

function drawGrid() {
  ctx.strokeStyle = "rgba(40, 80, 120, 0.18)";
  ctx.lineWidth = 1;
  const gap = 300;
  const vw = (canvas.width / dpr) / cam.zoom;
  const vh = (canvas.height / dpr) / cam.zoom;

  const x0 = Math.floor(cam.x - vw / 2);
  const y0 = Math.floor(cam.y - vh / 2);
  const gx0 = Math.floor(x0 / gap) * gap;
  const gy0 = Math.floor(y0 / gap) * gap;

  for (let x = gx0; x <= x0 + vw; x += gap) {
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + vh); ctx.stroke();
  }
  for (let y = gy0; y <= y0 + vh; y += gap) {
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + vw, y); ctx.stroke();
  }
}

function drawWorldBorder() {
  ctx.strokeStyle = "rgba(255, 31, 90, 0.6)";
  ctx.lineWidth = 15;
  ctx.strokeRect(0, 0, C.WORLD, C.WORLD);
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  const big = 50000;
  ctx.fillRect(-big, -big, big + C.WORLD + big, big);
  ctx.fillRect(-big, C.WORLD, big + C.WORLD + big, big);
  ctx.fillRect(-big, 0, big, C.WORLD);
  ctx.fillRect(C.WORLD, 0, big, C.WORLD);
}

function drawSnakes() {
  for (const s of state.snakes) {
    if (!s.alive) continue;

    const isPlayer = (s === player);
    const thickness = getThickness(s.mass);
    const isPhasing = state.time < s.phaseEndTime;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (isPhasing) {
      ctx.globalAlpha = 0.4;
      ctx.shadowBlur = thickness;
      ctx.shadowColor = `hsl(${s.hue}, 100%, 80%)`;
    } else {
      // Glow logic
      ctx.shadowBlur = s.boosting ? thickness * 0.8 : thickness * 0.3;
      ctx.shadowColor = `hsl(${s.hue}, 80%, 50%)`;
    }

    // Draw segmented body as a fluid spline path
    ctx.lineWidth = thickness;

    // Outer bright layer
    ctx.strokeStyle = `hsl(${s.hue}, 80%, 50%)`;
    ctx.beginPath();
    ctx.moveTo(s.head.x, s.head.y);
    for (let i = 0; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x, s.points[i].y);
    }
    ctx.stroke();

    // Inner bright core
    ctx.shadowBlur = 0;
    ctx.lineWidth = thickness * 0.5;
    ctx.strokeStyle = `hsl(${s.hue}, 100%, 80%)`;
    ctx.stroke();

    // Draw Head & Eyes
    ctx.fillStyle = `hsl(${s.hue}, 90%, 60%)`;
    ctx.beginPath();
    // Head wobble based on speed
    const stretch = (isPhasing || s.boosting) ? thickness * 0.3 : 0;
    ctx.ellipse(s.head.x, s.head.y, thickness * 0.6 + stretch, thickness * 0.6, s.angle, 0, Math.PI * 2);
    ctx.fill();

    // Eyes pointing in target dir
    const eyeDist = thickness * 0.25;
    const eyeSize = thickness * 0.15;
    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 5;
    ctx.shadowColor = "#fff";

    // Left eye
    const lx = s.head.x + Math.cos(s.angle - 0.5) * eyeDist;
    const ly = s.head.y + Math.sin(s.angle - 0.5) * eyeDist;
    ctx.beginPath(); ctx.arc(lx, ly, eyeSize, 0, Math.PI * 2); ctx.fill();

    // Right eye
    const rx = s.head.x + Math.cos(s.angle + 0.5) * eyeDist;
    const ry = s.head.y + Math.sin(s.angle + 0.5) * eyeDist;
    ctx.beginPath(); ctx.arc(rx, ry, eyeSize, 0, Math.PI * 2); ctx.fill();

    // Names
    if (!isPlayer && getTargetLength(s.mass) > 15) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.shadowBlur = 0;
      ctx.font = `bold ${Math.max(12, thickness * 0.4)}px Inter`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.name, s.head.x, s.head.y - thickness);
    }

    // Phase UI indicator
    if (isPlayer) {
      if (state.time < s.phaseCooldownTime) {
        // Draw cooldown ring around player head
        const pct = (s.phaseCooldownTime - state.time) / C.PHASE_COOLDOWN;
        ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s.head.x, s.head.y, thickness + 15, -Math.PI / 2, Math.PI * 2 * pct - Math.PI / 2);
        ctx.stroke();
      } else {
        // Ready indicator
        ctx.strokeStyle = "rgba(0, 255, 100, 0.7)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.head.x, s.head.y, thickness + 15 + Math.sin(state.time * 5) * 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

function drawFood() {
  ctx.shadowBlur = 0;
  for (const f of state.food) {
    if (!f.alive) continue;
    ctx.fillStyle = `hsl(${f.hue}, 80%, 60%)`;
    ctx.beginPath();
    ctx.arc(f.x, f.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const d of state.dropped) {
    if (!d.alive) continue;
    ctx.fillStyle = `hsl(${d.hue}, 100%, 75%)`;
    ctx.shadowBlur = 15;
    ctx.shadowColor = `hsl(${d.hue}, 100%, 60%)`;
    ctx.beginPath();
    // Drops scale with mass visually
    ctx.arc(d.x, d.y, clamp(6 + Math.sqrt(d.mass) * 2, 8, 30), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

let hudTimer = 0;
function updateHUD() {
  if (!player || !player.alive) return;

  const rank = getPlayerLevel(player.mass);
  if (scoreValueEl) scoreValueEl.innerText = Math.round(player.mass);
  if (scoreLevelEl) scoreLevelEl.innerText = `Lvl ${rank.level} • ${rank.title}`;

  // Leaderboard
  const sorted = [...state.snakes].filter(s => s.alive).sort((a, b) => b.mass - a.mass);
  const myRank = sorted.findIndex(s => s.id === player.id) + 1;
  if (myRank > 0 && myRank < bestRank) bestRank = myRank;

  lbListEl.innerHTML = "";
  for (let i = 0; i < Math.min(C.LB_SIZE, sorted.length); i++) {
    const s = sorted[i];
    const li = document.createElement("li");
    if (s.id === player.id) li.className = "me";
    li.innerHTML = `<span class="lb-name">${s.name}</span><span class="lb-score">${Math.round(s.mass)}</span>`;
    lbListEl.appendChild(li);
  }
}

function render() {
  const vw = canvas.width / dpr, vh = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#050a14";
  ctx.fillRect(0, 0, vw, vh);

  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

  drawGrid();
  drawFood();
  drawSnakes();
  drawWorldBorder();
  ctx.restore();

  // Particle Pass
  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
  ctx.globalCompositeOperation = "screen";
  for (const p of particles) {
    ctx.fillStyle = `hsla(${p.hue}, 90%, 70%, ${p.alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  for (const ft of floatingTexts) {
    const alpha = Math.max(0, ft.life / ft.maxLife);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.strokeStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
    ctx.lineWidth = 4 * ft.scale;
    ctx.font = `bold ${24 * ft.scale}px "Inter", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(ft.text, ft.x, ft.y);
    ctx.fillText(ft.text, ft.x, ft.y);
  }
  ctx.restore();
}

function showDeathScreen() {
  hudEl.classList.add("hidden");
  deathScreenEl.classList.remove("hidden");
  const timeSec = Math.floor(state.time - player.spawnTime);
  const m = Math.floor(timeSec / 60);
  const s = String(timeSec % 60).padStart(2, "0");
  timeAliveEl.innerText = `${m}:${s}`;
  topPositionEl.innerText = `#${bestRank}`;
}

function hideDeathScreen() {
  deathScreenEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
}

function tick(ts) {
  requestAnimationFrame(tick);
  const rawDt = (ts - prevTs) / 1000;
  prevTs = ts;
  if (rawDt > 0.1) return;

  fpsFrames++;
  fpsTime += rawDt;
  if (fpsTime >= 1.0) { fpsDisplay = fpsFrames; fpsFrames = 0; fpsTime = 0; }

  if (state.gameStarted && player && !player.alive) {
    if (hudEl.classList.contains("hidden") === false) showDeathScreen();
  } else if (state.gameStarted && player && player.alive) {
    accumulator += rawDt;
    while (accumulator >= SIM_DT) {
      simTick(SIM_DT);
      accumulator -= SIM_DT;
    }
  } else {
    // Menu background simulation
    accumulator += rawDt;
    while (accumulator >= SIM_DT) {
      simTick(SIM_DT);
      accumulator -= SIM_DT;
    }
  }

  updateParticles(rawDt);
  updateCamera(rawDt);

  if (state.gameStarted && state.time > hudTimer + 0.2) {
    updateHUD();
    hudTimer = state.time;
  }
  render();
}

function bindInput() {
  window.addEventListener("resize", resizeCanvas);

  document.addEventListener("mousemove", e => {
    mouseScreenX = e.clientX;
    mouseScreenY = e.clientY;
    const cw = screenToWorld(e.clientX, e.clientY);
    mouseWorldX = cw.x;
    mouseWorldY = cw.y;
  });

  document.addEventListener("mousedown", e => { if (e.button === 0) isBoosting = true; });
  document.addEventListener("mouseup", e => { if (e.button === 0) isBoosting = false; });

  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !e.repeat && document.activeElement !== nameInputEl) {
      phaseQueued = true;
    }
  });

  document.getElementById("playBtn").addEventListener("click", startGame);
  document.getElementById("respawnBtn").addEventListener("click", respawnPlayer);
  nameInputEl.addEventListener("keydown", e => {
    if (e.key === "Enter") startGame();
  });
}

function startGame() {
  startScreenEl.classList.add("hidden");
  hudEl.classList.remove("hidden");
  const name = nameInputEl.value.trim() || ("Player" + Math.floor(rand(10, 99)));
  state.gameStarted = true;
  bestRank = 999;
  spawnSnake(false, name);
}

function respawnPlayer() {
  hideDeathScreen();
  const name = nameInputEl.value.trim() || ("Player" + Math.floor(rand(10, 99)));
  bestRank = 999;
  spawnSnake(false, name);
}

function initWorld() {
  for (let i = 0; i < C.BOT_COUNT; i++) spawnSnake(true);
  for (let i = 0; i < C.FOOD_TARGET; i++) state.food.push(makeFood());
}

function boot() {
  resizeCanvas();
  bindInput();
  initWorld();
  requestAnimationFrame(t => { prevTs = t; tick(t); });
}

boot();
