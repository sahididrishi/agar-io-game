# Agar.io-Style FFA Production Mechanics Spec

Version: `1.0`  
Status: `Implementation Ready`  
Mode: `Free-For-All (FFA)`  
Authority Model: `Server authoritative`

## 1. Scope

This spec defines the production mechanics for an Agar.io-style FFA game:

- Real-time mass economy gameplay.
- Split/eject/virus interactions.
- Deterministic server simulation.
- Competitive leaderboard and spectator-safe behavior.

This spec does not define:

- UI/graphics style details.
- Monetization.
- Matchmaking across regions.

## 2. Core Design Targets

- Fair competitive outcomes under latency.
- Smooth movement at high entity counts.
- Predictable balancing via configurable constants.
- Efficient network bandwidth with viewport-based updates.

## 3. Runtime and Tick Model

- Simulation tick rate: `30 Hz` (`SIM_DT = 33.333ms`).
- Network snapshot rate: `20 Hz`.
- Leaderboard update rate: `2 Hz`.
- Fixed-step simulation only (no variable-step physics).

### Tick Order (must remain stable)

1. Ingest and validate player input intents.
2. Apply queued split/eject commands.
3. Compute movement for all mobile entities.
4. Resolve world bounds.
5. Resolve food/ejected consumption.
6. Resolve cell-vs-cell eat checks.
7. Resolve virus interactions.
8. Apply mass decay and anti-team modifiers.
9. Merge checks/recombination.
10. Spawn/replenish entities.
11. Recompute leaderboard.
12. Emit deltas to clients.

## 4. Units and Coordinate Space

- World size: `14142 x 14142` units.
- Position unit: `float32`.
- Mass unit: arbitrary scalar (`>= 0`).
- Radius formula:

```txt
radius = sqrt(mass) * RADIUS_SCALE
RADIUS_SCALE = 4.0
```

## 5. Entity Model

## 5.1 Player Cell

Required fields:

- `id: u32`
- `ownerId: u32`
- `x, y: f32`
- `vx, vy: f32`
- `mass: f32`
- `radius: f32`
- `birthTick: u32`
- `canMergeTick: u32`
- `isProtectedSpawn: bool`

## 5.2 Food Pellet

- `id, x, y`
- `mass = FOOD_MASS` (constant)

## 5.3 Ejected Mass

- `id, x, y, vx, vy`
- `mass = EJECT_PROJECTILE_MASS`
- `ownerId` for short no-recapture window

## 5.4 Virus

- `id, x, y`
- `mass`
- `radius`

## 6. Config Constants (Default)

```yaml
SIM_HZ: 30
SNAPSHOT_HZ: 20
LEADERBOARD_HZ: 2
WORLD_SIZE: 14142

SPAWN_MASS: 32
SPAWN_PROTECT_MS: 3000
MAX_CELLS_PER_PLAYER: 16

FOOD_MASS: 1
FOOD_TARGET_BASE: 1800
FOOD_TARGET_PER_PLAYER: 35

VIRUS_COUNT_BASE: 28
VIRUS_COUNT_PER_PLAYER: 0.25
VIRUS_MIN_MASS: 100
VIRUS_SPLIT_TRIGGER_CELL_MASS: 133
VIRUS_FEED_THRESHOLD_MASS: 126

SPLIT_MIN_MASS: 36
SPLIT_BOOST_SPEED: 780
SPLIT_BOOST_DECAY: 8.5

EJECT_MIN_MASS: 36
EJECT_COST_MASS: 16
EJECT_PROJECTILE_MASS: 13
EJECT_SPEED: 920
EJECT_COOLDOWN_MS: 80

MASS_DECAY_RATE_PER_SEC: 0.002
MASS_DECAY_MIN_MASS: 24

EAT_MASS_RATIO: 1.15
EAT_OVERLAP_FACTOR: 0.35

MERGE_BASE_MS: 30000
MERGE_EXTRA_MS_PER_MASS: 18

SPEED_MIN: 42
SPEED_MAX: 210
SPEED_EXPONENT: 0.43
SPEED_FACTOR: 86
```

## 7. Movement Model

For each cell every tick:

```txt
speed = clamp(SPEED_FACTOR * mass^(-SPEED_EXPONENT), SPEED_MIN, SPEED_MAX)
dir = normalize(cursorWorldPos - cellPos)
desiredVel = dir * speed
cellVel = lerp(cellVel, desiredVel, 0.28)
cellPos += cellVel * dt + splitBoostVel * dt
splitBoostVel *= exp(-SPLIT_BOOST_DECAY * dt)
```

Boundary:

- Hard clamp at world rectangle.
- Reflect split/ejected projectiles with damping `0.15` if needed (optional).

## 8. Split Mechanics

Eligibility per cell:

- `mass >= SPLIT_MIN_MASS`
- player total cells `< MAX_CELLS_PER_PLAYER`

On split:

- Parent mass halved.
- New child gets same half mass.
- Child spawn offset along aim vector by `parent.radius`.
- Child receives `splitBoostVel = aimDir * SPLIT_BOOST_SPEED`.
- `canMergeTick = now + MERGE_BASE_MS + mass * MERGE_EXTRA_MS_PER_MASS`.

Multi-split:

- On one `Space` press, evaluate largest cells first until cap reached.

## 9. Eject Mechanics (`W`)

Eligibility:

- `mass >= EJECT_MIN_MASS`
- per-cell cooldown satisfied.

On eject:

- Cell mass decreases by `EJECT_COST_MASS`.
- Spawn projectile with `EJECT_PROJECTILE_MASS`.
- Projectile starts at cell edge toward aim direction.
- Projectile velocity `aimDir * EJECT_SPEED`.
- Projectile slows with drag until near-static.

## 10. Eat Resolution

A cell `A` can consume entity `B` only if:

1. `A.mass >= B.mass * EAT_MASS_RATIO`
2. Center distance:

```txt
dist(A,B) <= A.radius - B.radius * EAT_OVERLAP_FACTOR
```

3. Additional constraints:

- Own ejected mass cannot be re-eaten for `250 ms`.
- Spawn protection blocks being eaten.

Mass transfer:

- `A.mass += B.mass * 1.0` (or tuned absorption efficiency).

## 11. Cell-vs-Cell Ownership Rules

- Same-owner cells:
  - Before `canMergeTick`: collide/soft push, no eat.
  - After `canMergeTick`: overlap merge allowed.
- Different owners:
  - Use normal eat checks.

Merge output:

- New mass = sum of merged parts.
- Preserve momentum weighted by mass.

## 12. Virus Mechanics

Virus baseline:

- Spawn with `VIRUS_MIN_MASS`.
- Static movement unless shot.

Feeding virus:

- Virus eats ejected mass on contact.
- Virus mass increases accordingly.
- If mass reaches `VIRUS_FEED_THRESHOLD_MASS`, virus fires a new virus in feed direction and resets mass to baseline.

Player-virus contact:

- If player cell mass `< VIRUS_SPLIT_TRIGGER_CELL_MASS`: bounce only.
- Else forced split into many pieces:
  - Piece count:

```txt
targetPieces = min(MAX_CELLS_PER_PLAYER, currentPieces + N)
N chosen so no piece exceeds preferred cap mass (e.g. 36-72)
```

  - Distribute mass across pieces with one larger remainder + several small pieces.
  - Apply radial boost impulses.

## 13. Mass Decay

Applied each tick for player cells:

```txt
if mass > MASS_DECAY_MIN_MASS:
  mass -= mass * MASS_DECAY_RATE_PER_SEC * dt
```

Optional anti-snowball tuning:

- Additional decay multiplier for top total-mass percentile.

## 14. Spawning and Replenishment

Food target:

```txt
foodTarget = FOOD_TARGET_BASE + FOOD_TARGET_PER_PLAYER * activePlayers
```

Spawn strategy:

- Maintain target count with random samples.
- Reject samples too close to large cells (`distance < 2.2 * radius`) to reduce instant free mass.

Virus target:

```txt
virusTarget = floor(VIRUS_COUNT_BASE + VIRUS_COUNT_PER_PLAYER * activePlayers)
```

## 15. Leaderboard Rules

- Player score = sum of alive cell masses.
- Rank descending by score.
- Tie-breakers:
  1. Earliest join tick.
  2. Lowest player id.

Expose top `10`.

## 16. Networking Contract (Minimum)

Client -> Server intents:

- `join {name, skin}`
- `input {cursorX, cursorY, seq}`
- `split {seq}`
- `eject {seq}`
- `ping {ts}`

Server -> Client:

- `welcome {playerId, worldSize, tickRate, constantsHash}`
- `snapshotDelta {tick, entitiesAdded, entitiesUpdated, entitiesRemoved}`
- `leaderboard {tick, top}`
- `death {killerId?, survivedMs}`
- `pong {ts}`

Rules:

- Inputs are sequence-numbered and idempotent.
- Server ignores impossible command rates.
- Client prediction allowed for local feel, but corrected by authoritative snapshots.

## 17. Interest Management

- Spatial hash grid: cell size `256`.
- For each player, stream only entities within viewport + margin.
- View radius based on total mass:

```txt
viewRadius = clamp(1800 - log(totalMass + 1) * 180, 900, 1800)
```

## 18. Anti-Abuse and Fairness

- Rate-limit split/eject spam.
- Clamp names and sanitize text.
- Detect bot-like packet cadence and disconnect on thresholds.
- Teaming pressure metric (optional):
  - Track mass transfers and non-aggression windows.
  - Apply temporary extra decay if sustained collusion exceeds threshold.

## 19. Determinism and Replay

- Use seeded RNG per room.
- Log input stream by tick for replay/debug.
- Deterministic collision sorting:
  - sort candidates by `(ownerId, cellId)` before resolution.

## 20. Performance Budgets

- Target room size: `120` concurrent players.
- Peak entities: `10k+` including food/ejected.
- Per-tick server budget: `< 12ms` at target load.
- Snapshot budget per client: `< 35 KB/s` average.

## 21. Test Plan (Required)

Unit tests:

- Radius/speed formulas.
- Eat eligibility boundaries.
- Merge cooldown logic.
- Virus split distribution.

Simulation tests:

- Deterministic replay produces identical final hash.
- No negative mass/radius invariants.
- Entity count ceilings maintained.

Load tests:

- 120 bots for 20 minutes.
- No tick drift beyond `+/-1` tick/minute.
- P95 tick time under `20ms`.

## 22. Acceptance Criteria

- Game remains stable for 24h soak test.
- No desync causing ghost-eats over replay validation set.
- Leaderboard correctness matches server authoritative totals.
- Room restart and reconnect flows recover cleanly.

## 23. Configurability

All constants in Section 6 must be runtime-configurable per room profile:

- `classic`
- `fast`
- `streamer`

Each profile stores versioned config and can be rolled back.
