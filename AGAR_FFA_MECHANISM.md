# Agar.io FFA Mechanism (Implementation Blueprint)

This document lays out the full game mechanism for `https://agar.io/#ffa` as an implementation-ready model.

## 1. Match Setup

- Player connects to an FFA room/server.
- Player spawns as a small single cell.
- Objective: grow total mass and stay on leaderboard.
- Leaderboard rank is based on the sum of all alive cells owned by a player.

## 2. Core Entities

- `PlayerCell`: owner, position, velocity, mass, radius, split/merge state.
- `FoodPellet`: small map pickups that increase mass.
- `EjectedMass`: mass projectiles created by `W`.
- `Virus`: spiky hazard object that can split large cells.

## 3. Input Model

- Continuous pointer input sets movement direction.
- `Space`: split eligible cells into two with forward burst.
- `W`: eject mass toward cursor direction.
- Client sends intents; server is authoritative and resolves outcomes.

## 4. Server Tick Loop (Main Mechanism)

```text
every tick:
1) read intents (movement, split, eject)
2) update movement (small cells faster, large cells slower)
3) clamp to world bounds
4) spawn/maintain food and viruses
5) resolve collisions:
   - cell vs food
   - cell vs ejected mass
   - cell vs virus
   - cell vs cell (eat or bounce)
6) apply mass decay
7) apply merge cooldown for split pieces
8) recompute leaderboard and visibility sets
9) broadcast state deltas to clients
```

## 5. Mass Economy and Typical Constants

These values are commonly documented in community implementations and may differ from current official live tuning:

- Split threshold: around `35` mass.
- Eject threshold: around `35` mass.
- Max pieces per player: `16`.
- Virus pop threshold: around `133` mass.
- Virus feeding bonus is often documented as `+100` mass per eaten ejected pellet cycle.
- Mass decay is commonly around `0.2%` per second.
- Forced splitting for very large cells appears in many clones near `22,500` mass per piece.
- Merge delay is typically base time plus a mass-dependent extension.

## 6. Collision and Eating Rules

- A cell can eat only sufficiently smaller targets.
- Larger overlap and center penetration increase eat certainty.
- Split provides burst mobility for catches but increases vulnerability.
- Virus interactions produce high-volatility state changes and comeback opportunities.
- Ejected mass is both tactical utility and efficiency tradeoff.

## 7. Networking and Authority

- Transport is WebSocket with compact/binary messages.
- Server owns game truth (anti-cheat and fair collision resolution).
- Client handles rendering, interpolation, and input capture.
- Modern official client internals are obfuscated, so exact current constants are not fully transparent.

## 8. FFA Dynamics

- All players are enemies.
- Unofficial teaming still occurs socially.
- Anti-team balancing exists in many implementations, but exact live formulas are not publicly clear.
- Long-running lobbies naturally converge into top-heavy late-game states.

## 9. Minimal Data Model

```ts
type Cell = {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  canMergeAt: number;
  isVirus: boolean;
  isEjected: boolean;
};
```

## 10. Competitive Balance Levers

- Spawn mass and safe-spawn radius.
- Movement speed curve by mass.
- Split burst distance and cooldown.
- Eject cost and projectile speed.
- Virus count and spawn distribution.
- Global decay and anti-team penalties.
- Food replenishment rate by active player count.

## 11. Practical Implementation Notes

- Keep deterministic collision order on the server each tick.
- Use spatial partitioning (grid/quadtree) for nearby collision checks.
- Broadcast only relevant entities per player viewport.
- Use delta compression and sequence IDs for smoother client interpolation.
- Separate simulation tick rate from client render FPS.

## References

- [Miniclip support: How to start playing Agar.io](https://support.miniclip.com/hc/en-us/articles/4404685562641-How-to-start-playing-Agar-io)
- [Agar.io Wiki: FFA mode](https://agario.fandom.com/wiki/FFA_Mode)
- [Agar.io Wiki: Cell](https://agario.fandom.com/wiki/Cell)
- [Agar.io Wiki: Splitting](https://agario.fandom.com/wiki/Splitting)
- [Agar Wiki: Virus](https://agardotio.fandom.com/wiki/Virus)
- [Ogar issue discussion: protocol notes](https://github.com/OgarProject/Ogar/issues/569)
- [Agar.io Wiki: Code overview](https://agario.fandom.com/wiki/Code)
- [agario-client repo note on protocol/client changes](https://github.com/pulviscriptor/agario-client)
