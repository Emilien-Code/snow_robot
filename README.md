# Three.js Boilerplate

Minimal [Three.js](https://threejs.org/) (r186) + TypeScript + Vite starter, rendering a single cube.

It uses `WebGPURenderer` (with automatic WebGL2 fallback), so materials can be written with [TSL](https://threejs.org/docs/TSL.html) node materials.

## Getting started

```bash
pnpm install
pnpm dev       # start the dev server
pnpm build     # type-check + production build
pnpm preview   # preview the production build
```

The [lil-gui](https://lil-gui.georgealways.com/) panel is always shown with `pnpm dev`; in a production build add `#debug` to the URL. Press **H** to show / hide it.

## Structure

```
src/
  main.ts              entry point
  Experience.ts        wires everything together, owns the scene and the loop
  classes/World.ts     base class for worlds
  worlds/CubeWorld.ts  the scene: grid floor + flying robot, camera follow — start here
  objects/
    Robot.ts           flying cube: ZQSD / arrows, acceleration + drag, hover and tilt
  common/sources.ts    assets to preload (textures, GLTF models) from /public
  utils/
    Camera.ts          perspective camera + OrbitControls
    Renderer.ts        WebGPURenderer setup and render call
    Ressources.ts      asset loader, emits 'ready'
    Sizes.ts           viewport size, emits 'resize'
    Time.ts            rAF loop, emits 'tick'
    Helpers.ts         lil-gui debug panel
    Keyboard.ts        held keys tracker
    EventEmitter.ts    tiny event emitter
```

## Tutorials

- `docs/tunnel-tutorial/README.md` walks through building a rocky TSL tunnel step by step (to replace the grid floor). Solution: `docs/tunnel-tutorial/Tunnel.ts`.
- `docs/postprocessing-tutorial/README.md` walks through adding post-processing (AO, bloom, color grading, vignette, grain, SMAA) with a TSL `RenderPipeline`. Solution: `docs/postprocessing-tutorial/Renderer.ts`.
- `docs/headlight-tutorial/README.md` walks through giving the robot its own headlight (`PointLight`). Solution: `docs/headlight-tutorial/Robot.ts`.
