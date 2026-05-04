# Example: Neon Courier 2D

## Prompt

> "Build a browser-based 2D endless runner game. The player controls a neon bike that dodges obstacles. Use TypeScript and Canvas API. Add score, speed increase over time, and game-over restart."

## Expected Output

- Single-file or Vite + TypeScript project
- Canvas 2D rendering
- Keyboard controls (arrow keys / WASD)
- Score + speed ramp
- Game over + restart flow

## Actual Output

See [RUN_REPORT.md](./RUN_REPORT.md) for the full agent run log.

## What Worked

- [x] Game loop stable at 60fps
- [x] Collision detection functional
- [x] Speed ramp feels good
- [x] Restart flow works

## Known Limitations

- No sound effects
- No mobile touch controls
- Sprite art is geometric primitives only

## Run It

```bash
cd output/
npm install
npm run dev
```
