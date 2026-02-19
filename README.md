# Population Clash 100

An **Agar.io-inspired country battle simulation** where the top 100 countries by population compete for survival. Built for social media content, livestreaming, and interactive viewer engagement.

## Features

- **100 Countries** — Population-weighted starting mass with real flag emojis
- **Smart AI** — Countries seek food, chase prey, flee threats
- **Live Leaderboard** — Mass bars, kill counts, real-time rankings
- **Global Events** — Resource Bloom, Turbo Currents, Famine Pulse, Meteor Shower, Magnetic Storm, Underdog Surge, Divine Protection
- **Crowd Control** — Viewer commands for interactive livestreaming (`/boost`, `/freeze`, `/feed`, `/meteor`, `/shield`, `/storm`)
- **Visual Effects** — Particle bursts, blob wobble, glow effects, kill feed overlay, confetti celebration
- **Camera Modes** — Leader (follows #1), Action (follows kills), Arena (full overview)
- **Performance** — Spatial hash grid, batched rendering, 60fps on modern hardware
- **Deploy Ready** — Static files, no build step, works on any hosting

## Quick Start

Open `index.html` in a modern browser. The simulation starts automatically after a brief loading screen.

## Commands

Type in the command box or use the browser console:

| Command | Description |
|---------|-------------|
| `/boost country amount` | Add mass to a country |
| `/freeze country seconds` | Stun a country |
| `/feed country pellets` | Spawn food nearby |
| `/meteor [country]` | Strike from above |
| `/shield country seconds` | Grant temporary immunity |
| `/storm seconds` | Create a magnetic vortex |
| `/speed 1\|2\|4` | Change playback speed |

## API (for Crowd Control integration)

```js
window.CrowdControl.applyCommand("/boost india 120");
window.CrowdControl.boostCountry("Brazil", 150);
window.CrowdControl.freezeCountry("China", 5);
window.CrowdControl.shieldCountry("USA", 8);
window.CrowdControl.meteor("Japan");
window.CrowdControl.startStorm(15);
```

## Deployment

This is a static site — deploy to any hosting:

- **GitHub Pages** — Push to repo, enable Pages
- **Netlify** — Drag-and-drop the folder
- **Vercel** — `vercel --prod`
- **Any web server** — Serve the directory

## Tech Stack

- Vanilla HTML/CSS/JavaScript (no framework, no build step)
- Canvas 2D rendering with spatial optimization
- CSS glassmorphism + custom animations
