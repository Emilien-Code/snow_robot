# Snow on the rock tunnel with TSL (Three.js r186, WebGPU)

This is the sequel to the rock tunnel tutorial (`README.md`). The tunnel is rocky, but we're in a snow project: time to let the snow pile up on it. Not painted-on white: **real snow with volume**, which fills the cracks, rounds off the rock, and catches the light like a soft blanket.

By the end you'll have:

- a **snow layer** that is part of the shape, pushed by the vertex shader like the rock
- snow that **fills the cracks and hides the sharp ridges**, but still follows the big boulders
- snow only where it makes sense: **the floor and lower walls**, not the ceiling
- **drifts**: big patches where the wind piled up more snow, and bare rock elsewhere
- a **soft junction** between snow and rock (smooth max)
- **snow colors and roughness**, from a mask you get for free
- **live controls** for everything in a `snow` folder

Everything happens in `src/objects/Rock.ts`. The finished code is in `docs/tunnel-tutorial/RockSnow.ts`. Try not to open it before you get stuck 🙂

---

## 0. Plan

| Step | What you build | What you learn | What you should see |
|---|---|---|---|
| 1 | Share the boulder noise | Reusing one node in several places, the cost of noise | Nothing changes (a refactor) |
| 2 | A snow surface, everywhere | "Level" thinking, `max()` of two heights | The whole tunnel wrapped in smooth, bumpy snow shapes |
| 3 | Snow only on the floor and lower walls | A mask from the tunnel's orientation, why not the real normal | Rock ceiling and upper walls, snowy lower walls |
| 4 | Drifts | Modulating the snow level with noise | Snow patches, bare rock sticking out between them |
| 5 | A soft junction | Smooth max (polynomial) | Rounded snow edges instead of sharp creases |
| 6 | Snow colors | Snow depth as a mask, `varying()` | White snow, grey rock |
| 7 | Tweaks + debug | lil-gui, debug views | A `snow` folder with sliders |

Each step ends with a **✅ Check**. Don't move on until it looks right.

---

## Key ideas before starting

### Heights along `inward`
Remember how the tunnel works: **final point = smooth tube point + inward × height**. The whole relief is one number per point, `rockHeight`: how far the rock sticks out toward the center of the tube.

The snow will use exactly the same system. It's **a second height**, `snowHeight`: how far the snow surface sticks out. Then, at every point, **the surface is whichever is higher**:

```
height = max(rockHeight, snowHeight)
```

```
                  snow level
          ~~~~~~~~~~~~~~~~~~~~~~~~        ← snow: smooth
  /\    /\~~~~~~~~~~~~~~~~~~~~~~~~/\      ← rock peaks poke out where they're higher than the snow
 /  \/\/  \  /\/\  (buried rock) /  \
```

Where the snow is higher, you see snow, and the rock underneath is hidden. Where the rock is higher, it pokes out. Nothing else to do: the snow **fills the cracks** automatically, because a crack is a place where the rock is low.

### Why this is nicer than painting
If you only changed the color (white where the ground faces up), the snow would take the exact shape of the rock: every sharp ridge and every crack, just white. Real snow is **smooth**: it hides the small details and only follows the big shapes. With a real height, the normals we already recompute (`p0`, `px`, `py`) see the smooth snow, so the **lighting** is right with no extra work.

### What we must NOT do
The obvious idea is "snow where the normal points up". But the normal is computed **from** the positions (finite differences, step 5 of the rock tutorial). If the positions depend on the normal, the normal depends on itself: a circular dependency. We'll use the **orientation of the smooth tube** instead, which we get for free (step 3).

---

## 1. Refactor: share the boulder noise

The snow will follow the **big boulders** of the rock, but not the ridges or cracks. So we need the boulder layer on its own.

Today it lives inside `rockHeight`. Move it to its own helper, and make `rockHeight` receive it:

```ts
// Big rock, shared by the rock and the snow so it's only computed once
private boulders(base: NodeV3): NodeF {
    const u = this.uniforms
    return mx_fractal_noise_float(base.mul(u.largeScale), 3).mul(u.largeStrength)
}

private rockHeight(base: NodeV3, boulders: NodeF): NodeF {
    const u = this.uniforms

    // Sharp rock
    const ridgeCoords = base.mul(vec3(1, u.ridgeStretch, 1)).mul(u.ridgeScale)
    const sharpRock = pow(abs(mx_noise_float(ridgeCoords)).oneMinus(), u.ridgeSharpness)

    // Small rock
    const cracks = mx_fractal_noise_float(base.mul(u.detailScale), 3)

    return boulders
        .add(sharpRock.mul(u.ridgeStrength))
        .add(cracks.mul(u.detailStrength))
}
```

Then add a `surface()` helper that returns **everything we know about a point**. `tunnelPoint` becomes a small wrapper around it:

```ts
private surface(p: NodeV2) {
    const base = this.basePoint(p)
    const boulders = this.boulders(base)
    const rock = this.rockHeight(base, boulders)
    const height = rock // the snow comes in step 2
    return { base, rock, height }
}

private tunnelPoint(p: NodeV2): NodeV3 {
    const { base, height } = this.surface(p)
    return base.add(this.inward(p).mul(height))
}
```

In the constructor, the color code called `rockHeight` directly. Use `surface()` instead:

```ts
const surface = this.surface(planePosition)
const base = surface.base
const height = varying(surface.rock)
```

> 💡 The old `theta` parameter of `rockHeight` was only used by the wall mask, which is commented out. It's gone now. If you bring the wall mask back one day, pass `this.getTheta(p)` again from `surface()`.

### Explanations

**Why pass `boulders` as a parameter instead of calling the noise twice?**
Remember: TSL builds a **graph**. Calling `mx_fractal_noise_float(...)` twice creates **two nodes**, and the GPU computes the noise twice. Calling it once and using the **same node** in two places lets Three.js store the result in a variable and reuse it. 3 octaves of noise is not free, and `tunnelPoint` already runs 3 times per pixel (for the normals), so this matters.

**Why return an object from `surface()`?**
In step 6, the colors need both the **rock** height and the **final** height (to know how much snow there is). Returning both from one place avoids rebuilding the whole noise graph a second time.

### ✅ Check
Exactly the same image as before. A refactor must not change anything visible.

---

## 2. A snow surface, everywhere

The snow surface follows the boulders, plus a thickness:

```ts
public uniforms = {
    // ... everything from before ...

    // Snow
    snowThickness: uniform(2),
}

/**
 * Height of the snow surface: it follows the boulders only (no ridges, no cracks),
 * so wherever it's above the rock, it fills the cracks and smooths everything.
 */
private snowHeight(boulders: NodeF): NodeF {
    return boulders.add(this.uniforms.snowThickness)
}
```

And in `surface()`:

```ts
const snow = this.snowHeight(boulders)
const height = max(rock, snow)
```

Don't forget `max` in the imports from `three/tsl`.

### Explanations

**Why the boulders and not the full rock?**
If the snow followed the full rock plus a thickness, it would just be the rock moved up by 2 m: same ridges, same cracks. Following **only the big shapes** is what makes it look like snow: a smooth blanket laid over the big boulders.

**Why 2? That buries everything!**
Look at what the rock adds on top of the boulders:
- `sharpRock` is always **positive** (between 0 and 1, ×0.8), and its peaks are thin: on average it lifts the rock by roughly 0.2–0.3
- `cracks` goes a bit up and down around 0 (×0.25)

So the rock is **on average above** the boulders. With a thin snow layer (0.2), the rock would poke out almost everywhere. Around 0.6 is the minimum to cover most of it.

For now, 2 buries the rock completely, and that's expected. In steps 3 and 4 the coverage and the drifts **lower the snow level** in most places, and a thick layer is what keeps deep snowbanks where they're at their maximum. It's the value that looked best once everything was in place.

### ✅ Check
The **whole tunnel** (ceiling included!) is covered in smooth, rounded shapes: with `snowThickness = 2` the rock is completely buried under a blanket that follows the big boulders. It's still rock-colored (the colors come in step 6), but the lighting is clearly smoother. Try `0.6` in code: the tallest ridges poke out. At 0 you see mostly rock.

---

## 3. Snow only on the floor and lower walls

Snow doesn't stick to ceilings, and it slides off steep walls. We need a **coverage** value: 1 where snow can settle, 0 where it can't.

### Which value tells us "facing up"?
We already have it: `inward(p)`, the direction from the wall toward the center of the tube. Its **y** is `cos(θ)`:

| Where | θ | `inward.y` |
|---|---|---|
| floor | 0 | 1 (facing straight up) |
| lower wall | ±π/4 | 0.7 |
| wall | ±π/2 | 0 (vertical) |
| ceiling | ±π | -1 (facing down) |

That's exactly "how much this part of the tunnel faces up".

```ts
public uniforms = {
    // ...
    snowThickness: uniform(2),
    snowSlope: uniform(0.35),
    snowSlopeBlend: uniform(0.3),
}

private snowHeight(base: NodeV3, p: NodeV2, boulders: NodeF): NodeF {
    const u = this.uniforms

    // 1 on the floor and lower walls, 0 on the upper walls and ceiling
    const up = this.inward(p).y
    const coverage = smoothstep(u.snowSlope, u.snowSlope.add(u.snowSlopeBlend), up)

    return boulders.add(mix(float(-1), u.snowThickness, coverage))
}
```

Update the call in `surface()`: `this.snowHeight(base, p, boulders)`. Add `float` to the imports. (`base` isn't used yet, but step 4 needs it.)

### Explanations

**Why `inward` and not the real normal?**
See "What we must NOT do" above. `inward` only depends on the angle θ, not on any position, so there's no loop. The price: the snow only knows about the **big shape** of the tunnel. A small ledge high up on a wall won't get snow, because the smooth tube is steep there. For this effect it's fine (and see "Going further" for how to fix it with the color).

**The coverage curve**

```
coverage
 1 |____________
   |            \
   |              \        ← blend over snowSlopeBlend = 0.3
 0 |                \______________
   1 (floor)    0.65   0.35    0 (wall)     -1 (ceiling)   inward.y
```

With `snowSlope = 0.35` and `snowSlopeBlend = 0.3`:
- full snow where `inward.y > 0.65`, so up to ~49° from the floor
- no snow where `inward.y < 0.35`, so beyond ~70°

With a radius of 13, that's snow up to about **y ≈ 4.5**, fading out by **y ≈ 8.5**. Real snow slides off slopes steeper than ~45–60°, so that's about right.

> 💡 The `SnowFloor` plane covers the very bottom of the tunnel. That's why the coverage has to reach the **lower walls**: that's the part you actually see, and where the snow on the rock meets the snow on the floor. The two blend together, which also hides the hard line where the snow floor used to cut through the rock.

**Why `mix(-1, thickness, coverage)` and not `thickness × coverage`?**
With `thickness × coverage`, where there's no coverage the snow level would be **exactly the boulders**. And the rock is often close to the boulders (where the ridges and cracks are near 0). The snow would still show up in random places on the ceiling.

Instead, where there's no coverage, we **bury** the snow level 1 m below the boulders, far under the rock. Think of it as a water level going down: the lower it is, the less of it you see.

```
coverage = 1:  snow level = boulders + 2       → above the rock everywhere
coverage = 0:  snow level = boulders - 1       → far under the rock, invisible
in between:    the level crosses the rock      → patches, rock sticking out
```

### ✅ Check
Rock ceiling and upper walls, snowy (smooth) lower walls, and a nice transition where the rocks slowly emerge from the snow as the walls get steeper.

---

## 4. Drifts

Right now the snow is the same everywhere along the tunnel. Real snow is uneven: the wind piles it up in some places and blows it away elsewhere. We modulate the coverage with a big, slow noise:

```ts
public uniforms = {
    // ...
    snowDriftScale: uniform(0.305),
}

private snowHeight(base: NodeV3, p: NodeV2, boulders: NodeF): NodeF {
    const u = this.uniforms

    // 1 on the floor and lower walls, 0 on the upper walls and ceiling
    const up = this.inward(p).y
    const coverage = smoothstep(u.snowSlope, u.snowSlope.add(u.snowSlopeBlend), up)

    // Large patches where the wind piled up more snow
    const drift = mx_noise_float(base.mul(u.snowDriftScale)).mul(0.5).add(0.5)

    // amount = 0 → snow level buried 1 m under the boulders, amount = 1 → full thickness
    const amount = coverage.mul(drift)
    return boulders.add(mix(float(-1), u.snowThickness, amount))
}
```

### Explanations

**`noise × 0.5 + 0.5`** brings the noise from [-1, 1] to [0, 1], as for the tint in the rock tutorial.

**Why multiply with the coverage?** Both are "how much snow can be here", between 0 and 1. Multiplying keeps the ceiling at 0 whatever the noise does, and only reduces the snow where the drift noise is low.

**The scale.** `0.305` is about one patch every 3 m: lots of snowbanks close together, with rock showing between them. Smaller (`0.08`, one patch every ~12 m) gives long snowy stretches and long bare stretches as you fly through the tunnel. Much bigger (`0.5`) gives small spots, which starts to look like a pattern rather than weather.

**Sampled in 3D (`base`)**, like every other noise here: no seam, and the patch size stays in meters when you change the radius.

> 🧪 Try `snowThickness = 3`: the drifts become huge snowbanks and almost no rock pokes out on the lower walls. Then try `0.6`: only the deepest hollows keep some snow, like at the end of winter.

### ✅ Check
As you fly along the tunnel, the snow comes and goes in big patches. Between them, the rock is bare (or only has snow in the hollows).

---

## 5. A soft junction: smooth max

Look closely where the rock pokes out of the snow: there's a **sharp crease**. `max()` picks one or the other with no transition, and the lighting shows that edge. Real snow makes a **rounded** junction against the rock.

The fix is the **smooth max**, a `max()` that rounds the corner where both values are close:

```ts
public uniforms = {
    // ...
    snowSoftness: uniform(1),
}

// Like max(a, b), but rounded where a and b are closer than k
private smoothMax(a: NodeF, b: NodeF, k: NodeF): NodeF {
    const h = max(k.sub(abs(a.sub(b))), 0).div(k)
    return max(a, b).add(h.mul(h).mul(k).mul(0.25))
}
```

In `surface()`:

```ts
const height = this.smoothMax(rock, snow, this.uniforms.snowSoftness)
```

### How it works

```
h = max(k - |a - b|, 0) / k
```

- If `a` and `b` are **far apart** (`|a - b| ≥ k`): `h = 0`, and the result is exactly `max(a, b)`. Nothing changes.
- If they're **equal** (`|a - b| = 0`): `h = 1`, and we add `k / 4` on top.
- In between, `h` goes smoothly from 0 to 1, and `h²` makes the added bump ease in.

```
      plain max                    smooth max
         \      /                     \      /
          \    /                       \    /
           \  /                         '..'      ← rounded, lifted by up to k/4
            \/   ← sharp crease
```

It's the same trick as the famous *smooth min* used to blend shapes in raymarching (just flipped).

**`k` = softness**, in meters: how close the two heights must be before the rounding starts. `1` gives a very soft, rounded snow line, like snow that piled up against the rock. `0.3` makes it "hug" the rock more tightly. At `0.01` you're back to the sharp `max()`.

> ⚠️ `k` is a divisor: never let it reach 0. That's why the slider in step 7 starts at `0.01`.

> 💡 This is also why step 3 buries the snow **1 m** under the boulders where there's no coverage. With the smooth max, a snow level just barely under the rock would still lift it by up to `k / 4`. At 1 m under, it's about as far as `k = 1`, so what's left is a lift of a few millimeters, too small to see (and below the 2 cm threshold of the snow mask in step 6). If you push `softness` well above 1, bury the snow deeper too: `mix(float(-2), …)`.

### ✅ Check
The junctions between snow and rock are soft. Compare by changing `snowSoftness` in code (0.01 vs 1): the lighting along the snow line is the giveaway.

---

## 6. Snow colors

The snow has a shape, but it's still rock-colored. We need a **mask**: 1 where there's snow, 0 where there's rock.

Good news: we already have it. **The snow depth** is how far the final surface is above the rock:

```
snowDepth = height - rock
```

- bare rock: `height = rock`, so the depth is 0
- under snow: the depth is how many meters of snow cover the rock

```ts
public uniforms = {
    // ...
    snowColor: uniform(new THREE.Color('#f2f5fa')),
    snowRoughness: uniform(0.8),
}
```

In the constructor, in the color part:

```ts
const surface = this.surface(planePosition)
const base = surface.base
const height = varying(surface.rock)
// How much snow sits on top of the rock (0 = bare rock)
const snowDepth = varying(surface.height.sub(surface.rock))

// ... grain, tint, cavity, rock color as before ...

const dust = smoothstep(u.dustThreshold, u.dustThreshold.add(0.2), normal.y)
rock = mix(rock, u.dustColor, dust.mul(u.dustStrength))

// A few centimeters of snow are enough to hide the rock
const snowMask = smoothstep(0.02, 0.1, snowDepth)
material.colorNode = mix(rock, u.snowColor, snowMask)
```

And for the roughness, at the end:

```ts
const roughness = mix(u.roughnessIce, u.roughnessRock, iceNoise)
material.roughnessNode = mix(roughness, u.snowRoughness, snowMask)
```

### Explanations

**Why `varying()`?** Same as the rock height in the rock tutorial: the whole noise graph (boulders, ridges, cracks, drift) runs **in the vertex shader** once per vertex, then the result is interpolated for the pixels. Without `varying`, every pixel would compute it all **again**, on top of the 3 evaluations for the normals.

**Why `smoothstep(0.02, 0.1, …)` and not just `depth > 0`?**
- Below 2 cm, we say "bare rock". Thanks to the smooth max, the snow slightly lifts the rock near the snow line: without this margin, a thin white halo would appear around every rock.
- From 2 to 10 cm, a quick fade: a real snow edge is not a sharp line.
- Above 10 cm, it's fully white.

**Why `mix(rock, …)` at the end and the dust before?** The rock color is built layer by layer (cavity, tint, dust). The snow goes **on top of everything**, so it's the last `mix`.

**The snow color.** `#f2f5fa` is a very slightly blue white. Pure white `#ffffff` with the robot's warm light can look like plastic. Try matching the `SnowFloor` color so the rock snow and the floor snow read as the same material.

**The roughness.** Fresh snow is very rough (a matte surface). `0.8` keeps it matte, with a slight sheen under the robot's headlight. Lower it (`0.4`) for old, icy snow that catches the light.

### ✅ Check
White snow on the lower walls in big patches, grey-brown rock above and between the patches, and dark rock ridges poking out of the snow here and there. 🎉

---

## 7. Tweaks + debug

### The GUI
Add a `snow` folder at the end of `debug()`, same pattern as the others:

```ts
const snow = folder.addFolder('snow')
snow.add(u.snowThickness, 'value', 0, 4, 0.01).name('thickness')
snow.add(u.snowSlope, 'value', -1, 1, 0.01).name('slope')
snow.add(u.snowSlopeBlend, 'value', 0.01, 1, 0.01).name('slopeBlend')
snow.add(u.snowDriftScale, 'value', 0.01, 0.5, 0.001).name('driftScale')
snow.add(u.snowSoftness, 'value', 0.01, 2, 0.01).name('softness')
snow.add(u.snowRoughness, 'value', 0, 1, 0.01).name('roughness')
this.addColor(snow, u.snowColor, 'color')
```

- `slope` goes from **-1 to 1** because it's compared with `inward.y`, which covers that range. At `-1`, even the ceiling gets snow (a fun way to check the coverage works).
- `slopeBlend` and `softness` start at `0.01`: `smoothstep` with two equal edges and the smooth max with `k = 0` both divide by zero.

### Debug view
When something looks off, look at the snow depth directly:

```ts
// Debug: snow depth displayed in the red channel
material.colorNode = vec3(snowDepth, 0, 0)
```

Black = bare rock, red = snow (brighter = deeper). It's much easier to understand the drifts and the coverage like this than with white on grey.

### ✅ Check
Every slider changes the snow live. Good ones to play with: `thickness` (from a sprinkle to a blizzard), `slope` (how high the snow climbs up the walls), `driftScale` (patch size).

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Snow on the ceiling | Coverage built with `thickness × coverage` instead of `mix(-1, thickness, coverage)` (step 3), or `slope` too low |
| The whole tunnel is black / NaN | `snowSoftness` or `snowSlopeBlend` at 0 (division by zero) |
| Snow looks exactly like white rock (ridges and cracks visible) | `snowHeight` built from the full rock height instead of the boulders only (step 2) |
| A thin white halo around every rock | The snow mask starts at 0: use `smoothstep(0.02, 0.1, …)` (step 6) |
| Snow is smooth but the lighting shows sharp creases at the edges | `max()` instead of `smoothMax()` (step 5) |
| White patches that don't match the shape | The snow mask is computed from different nodes than the position: use `surface()` for both (step 1) |
| FPS dropped a lot | The boulder noise is computed twice: pass `boulders` around instead of calling the noise again (step 1) |
| Hard line where the snow floor meets the rock | The coverage doesn't reach high enough: lower `slope` so the snow climbs above the `SnowFloor` plane |

## Going further

1. **Snow on the small ledges.** The volume only uses the tunnel's orientation, so ledges high up on the walls stay bare. Add a **color-only** snow on top: `smoothstep(0.7, 0.8, normal.y)` + a bit of noise, mixed into `snowMask` with `max()`. The normal is fine here, since the color doesn't change the positions.
2. **Snow sparkle.** Use a very high-frequency noise on the snow to make a few pixels very smooth (`roughness ≈ 0.1`): tiny glints under the robot's headlight.
3. **Blue shadows.** Snow in the shade looks blue (it reflects the sky). Mix a light blue into the snow color in the cavities (`cavity` is already there).
4. **Accumulation over time.** Animate `snowThickness` from `-0.5` to `1` over a minute: the snow slowly fills the cracks, then buries the rock. Pair it with falling snow particles.
5. **Wind direction.** Make the drifts stretched along the tunnel: `base.mul(vec3(1, 1, 0.3))` before the drift noise, as we did for the strata.
6. **Optimization.** Everything runs 3 times per pixel for the normals. Wrap the normal in `varying()` to compute it per vertex, and compare the FPS.

## Glossary

- **Snow level**: the height of the snow surface along `inward`. Snow is visible wherever it's above the rock.
- **Coverage**: how much snow a part of the tunnel can hold, from its orientation (0 to 1).
- **Drift**: a patch where the wind piled up more (or less) snow.
- **Smooth max**: a `max()` that rounds the transition where both values are close, controlled by `k`.
- **Snow depth**: final height minus rock height. 0 = bare rock. Used as the snow mask.
- **Circular dependency**: a value that depends on itself (here: positions from the normal, normal from the positions). Not possible in a shader.
