# Example: Neon Courier FPS

## Prompt

> "Build a first-person browser prototype where the player walks through a neon corridor and shoots geometric targets. Use Three.js and TypeScript."

## Expected Output

- Three.js + Vite + TypeScript project
- First-person camera (WASD + mouse look)
- Basic neon corridor environment
- Shootable targets with hit feedback
- Score display

## Actual Output

See [RUN_REPORT.md](./RUN_REPORT.md) for the full agent run log.

## What Worked

- [x] Three.js scene renders
- [x] FPS camera controls
- [x] Raycasting hit detection
- [x] Target spawn + destroy cycle

## Known Limitations

- No enemy AI (static targets only)
- No level progression
- Performance drops after ~50 targets on low-end GPUs

## Run It

```bash
cd output/
npm install
npm run dev
```
