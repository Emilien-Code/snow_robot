# Rock tunnel with TSL (Three.js r186, WebGPU)

In this tutorial you'll turn a flat plane into a rocky mountain tunnel, entirely inside the shader, with Three.js TSL (Three Shading Language). By the end you'll have:

- a plane **rolled into a tube** by the vertex shader (`positionNode`)
- **rock relief** made of several layers of noise (boulders, strata ridges, small cracks)
- a **flat, walkable floor** and much rougher walls and ceiling
- **correct lighting** on the relief, with normals recomputed per pixel (`normalNode`)
- **rock colors**: dark hollows, lighter bumps, a brown tint, and dust on flat ground (`colorNode`)
- **live controls** for every value (uniforms + lil-gui), including the tunnel radius

The finished code is in `docs/tunnel-tutorial/Tunnel.ts`. Try not to open it before you get stuck 🙂

---

## 0. Plan

| Step | What you build | What you learn | What you should see |
|---|---|---|---|
| 1 | A tall plane with lots of segments, and a first uniform | `PlaneGeometry`, segments, `MeshStandardNodeMaterial`, `uniform()` | A tall vertical sheet going through the robot |
| 2 | Roll the plane into a tube | `positionNode`, `positionGeometry`, TSL math, winding / face culling, `normalNode` | A smooth grey tube around the robot |
| 3 | Split the math into small helpers | Reusing TSL functions, node types | Nothing changes (a refactor) |
| 4 | First relief: push the surface inward with noise | `mx_noise_float`, sampling in 3D, displacement along a direction | Bumpy walls, but the lighting stays smooth (fake-looking) |
| 5 | Recompute the normals | Finite differences, cross product, per-pixel normals, view space | The bumps now catch the light |
| 6 | Real rock: 3 noise layers | fBm (octaves), ridged noise, stretched noise (strata) | Boulders, sharp ridges, cracks |
| 7 | Flat floor, wild walls | Masks with `smoothstep` / `mix`, working with the angle | A floor you can fly over, rough walls |
| 8 | Rock colors | `colorNode`, `varying()`, cavities, tint, dust from the normal | A real rock look |
| 9 | Tweaks | Uniforms vs constants, lil-gui, color spaces | Sliders that change everything live |
| 10 | Plug it into the world | Robot bounds, fog, lights | The final scene |

Each step ends with a **✅ Check** telling you what to look for. Don't move on until it looks right: most shader bugs come from a step that was "almost" working.

---

## Key ideas before starting

### What TSL is
TSL lets you write shaders in JavaScript/TypeScript. The important part: **TSL code doesn't compute anything when it runs in JS. It builds a graph of nodes**, and Three.js compiles that graph into a real shader (WGSL for WebGPU, or GLSL when it falls back to WebGL2).

```ts
const a = float(2)
const b = a.mul(3) // not 6: a node meaning "a × 3", computed later on the GPU for every vertex / pixel
```

That's why you can't write `a * 3` or `if (a > 1)` on nodes. You chain methods (`.mul()`, `.add()`, `.sub()`, `.div()`) or use TSL functions (`sin()`, `mix()`, `smoothstep()`, `If()`…).

### The 3 material "slots" we use
A `MeshStandardNodeMaterial` is a normal PBR material (it reacts to lights) in which you can replace some parts with your own nodes:

| Slot | Runs in | Replaces | We use it for |
|---|---|---|---|
| `positionNode` | vertex shader (once per vertex) | the vertex position, in **local** space | rolling the plane + the relief |
| `normalNode` | fragment shader (once per pixel) | the normal, in **view** space | lighting that matches the relief |
| `colorNode` | fragment shader | the base color (albedo) | the rock colors |

Everything else (lights, shadows, fog, tone mapping) is still handled by Three.js. You only replace what you need.

### Vertex vs fragment
- **Vertex shader**: runs once per vertex. It can **move** vertices, but it can't create new ones. More segments = more detail in the shape.
- **Fragment shader**: runs once per pixel on screen. It can't move anything, but it can compute very fine details (normals, colors) at pixel resolution.

We'll use both: the vertex shader for the big shape, the fragment shader for the fine lighting details.

---

## 1. The plane

Create `src/objects/Tunnel.ts`:

```ts
import * as THREE from 'three/webgpu'
import { uniform } from 'three/tsl'

export default class Tunnel {
    public mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>
    public readonly length: number

    // Values the shader can read, and that we can change at any time from JavaScript.
    public uniforms = {
        radius: uniform(6),
    }

    constructor(radius = 6, length = 200) {
        this.length = length
        this.uniforms.radius.value = radius

        // Width = 2π (a full turn in radians), height = the tunnel length.
        // 320 × 900 segments: lots of vertices, because the shader can only move existing vertices.
        const geometry = new THREE.PlaneGeometry(Math.PI * 2, length, 320, 900)
        const material = new THREE.MeshStandardNodeMaterial({
            color: '#888888',
            roughness: 0.95,
            metalness: 0,
            wireframe: true,
        })

        this.mesh = new THREE.Mesh(geometry, material)
    }

    public get radius() {
        return this.uniforms.radius.value
    }
}
```

Then in `src/worlds/CubeWorld.ts`, replace the grid floor with the tunnel (see step 10 for the full integration; for now this is enough):

```ts
import Tunnel from '../objects/Tunnel'
// ...
private tunnel: Tunnel
// ... in the constructor:
this.tunnel = new Tunnel(6, 200)
scene.add(this.tunnel.mesh)
// ... in dispose():
this.disposeObject(this.tunnel.mesh)
```

### Explanations

**Why is the plane 2π wide?**
`PlaneGeometry(width, height)` is centered on the origin, so its x coordinates go from `-width/2` to `+width/2`. With `width = 2π`, x goes from **-π to +π**, which is exactly one full turn in radians. In step 2 we'll use x **directly as the angle** around the tube. Nice side effect: the radius doesn't affect the geometry at all, so it can become a uniform we change live.

**Why so many segments?**
`320` segments around the tube and `900` along its length gives `321 × 901 ≈ 289,000` vertices. The vertex shader can only move vertices that exist. If you have few of them, the relief will look like big flat triangles. Along the length, 200 / 900 ≈ one vertex every 22 cm. Around the tube (radius 6), 2π×6 / 320 ≈ one vertex every 12 cm.
> 💡 A modern GPU handles 300k vertices very easily. The expensive part will be the pixel shader (step 5).

**What is a uniform?**
`uniform(6)` creates a value that is **sent to the GPU every frame**. You change it from JS with `uniform.value = 8`, and the shader uses the new value immediately without recompiling. A plain number written in the shader (`.mul(6)`) is a **constant**: it's baked in, so changing it means rebuilding the material.

**Where is the plane?**
`PlaneGeometry` lies in the **XY plane** (vertical) and faces **+Z** (toward the camera at the start).

### ✅ Check
You see a very tall vertical wireframe sheet crossing the robot. With 320×900 segments the wireframe is so dense it looks almost solid. To actually see the grid, **temporarily** use `PlaneGeometry(Math.PI * 2, length, 32, 90)`.

---

## 2. Roll the plane into a tube

Now the heart of the effect: every vertex of the plane is moved to a point on a circle.

```ts
import * as THREE from 'three/webgpu'
import { cos, positionGeometry, sin, transformNormalToView, uniform, vec3 } from 'three/tsl'

export default class Tunnel {
    public mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>
    public readonly length: number

    public uniforms = {
        radius: uniform(6),
    }

    constructor(radius = 6, length = 200) {
        this.length = length
        const u = this.uniforms
        u.radius.value = radius

        const geometry = new THREE.PlaneGeometry(Math.PI * 2, length, 320, 900)
        const material = new THREE.MeshStandardNodeMaterial({ color: '#888888', roughness: 0.95, metalness: 0 })

        // The plane's x (-π → π) becomes the angle around the tube.
        const theta = positionGeometry.x

        // Circle of radius R whose lowest point touches y = 0.
        material.positionNode = vec3(
            sin(theta).mul(u.radius), // x: left / right
            cos(theta).oneMinus().mul(u.radius), // y: 0 at the floor, 2R at the ceiling
            positionGeometry.y.negate(), // z: the plane's length becomes the tunnel's depth
        )

        // The normal of a smooth tube points toward its center.
        const inward = vec3(sin(theta).negate(), cos(theta), 0)
        material.normalNode = transformNormalToView(inward)

        this.mesh = new THREE.Mesh(geometry, material)
        // Three.js computes the bounds from the flat plane: don't let it hide the tunnel by mistake.
        this.mesh.frustumCulled = false
    }

    public get radius() {
        return this.uniforms.radius.value
    }
}
```

### The math, slowly

A circle of radius `R` centered on the origin is `(R·sin θ, -R·cos θ)`: θ = 0 gives the bottom point `(0, -R)`.
We want the **floor at y = 0** (that's where the robot hovers), so we lift the circle by `R`: its center is at `(0, R)`.

```
x = R · sin θ
y = R - R · cos θ   = R · (1 - cos θ)    ← that's `cos(theta).oneMinus().mul(R)`
```

| θ | Where | x | y |
|---|---|---|---|
| 0 | floor | 0 | 0 |
| π/2 | right wall | R | R |
| -π/2 | left wall | -R | R |
| ±π | ceiling | 0 | 2R |

```
            θ = ±π  (ceiling, y = 2R)
                 ___
              .'     '.
   θ = -π/2  |    •    |  θ = π/2        • = center (0, R)
   left wall  '.     .'   right wall
                 ‾‾‾
             θ = 0  (floor, y = 0)
```

The plane's **y** (from -100 to +100) becomes the tunnel's **z**, the depth.

### `positionGeometry` vs `positionLocal`
- `positionGeometry` = the **raw attribute** of the geometry, the original point of the flat plane. It never changes.
- `positionLocal` = the local position **as the material sees it**, which includes the `positionNode` changes.

We always use `positionGeometry`, because we need the **original plane coordinates** (angle + depth) as input to our math. That will matter even more in step 5, where the fragment shader re-runs the same math.

### Why `negate()` on z? (face culling)
A triangle has a **front** and a **back**, determined by the order of its vertices (the *winding*). By default Three.js only draws the front (`side: FrontSide`).
The flat plane's front faces +Z. When we roll it:
- with `z = -y`, the front faces **inward**, toward the center of the tube, which is where our camera is. ✅
- with `z = +y`, the tube is mirrored, the front faces **outward**, and from inside you see… nothing.

> 🧪 Try it: remove `.negate()`. The tunnel disappears (only the robot is left on a black background). Put it back.

You could also use `side: THREE.DoubleSide`, but understanding the winding is better, and it also tells us which way the normals point (step 5).

### Why set `normalNode`?
The plane's normal attribute is `(0, 0, 1)` everywhere, since it was flat. Moving the vertices **does not update the normals**, so the lighting would be completely wrong. For a smooth tube, the normal is the direction toward the center:

```
center - point = (0, R) - (R·sin θ, R - R·cos θ) = (-R·sin θ, R·cos θ)   → normalized: (-sin θ, cos θ, 0)
```

`normalNode` expects a normal **in view space** (relative to the camera), because that's where Three.js computes lighting. `transformNormalToView()` converts our local normal to view space: first with the object's normal matrix, then with the camera's view matrix.

### `frustumCulled = false`
Before drawing, Three.js checks whether the object is inside the camera's field of view (*frustum culling*), using the bounding sphere of the **CPU geometry**. That's the flat plane, not the tunnel the shader creates. To avoid the tunnel vanishing at some angles, we turn this check off. (A cleaner option is to set `geometry.boundingSphere` yourself to match the real tunnel.)

### ✅ Check
A smooth grey tube around the robot, lit by the robot's headlight. Remove `wireframe: true` if you still had it.

---

## 3. Refactor: small reusable helpers

We'll need the tunnel point **several times** (the vertex position, then 3 more times for the normals in step 5), and the angle and inward direction in several places too. We split the math into small methods that **return nodes**.

```ts
type NodeF = THREE.Node<'float'>
type NodeV2 = THREE.Node<'vec2'>
type NodeV3 = THREE.Node<'vec3'>
```

These types only help TypeScript. `Node<'vec3'>` means "a node that produces a vec3".

```ts
// Angle around the tunnel axis: 0 is the floor, ±π is the ceiling.
private angle(p: NodeV2): NodeF {
    return p.x
}

// Direction pointing from the tube surface toward its center axis.
private inward(p: NodeV2): NodeV3 {
    const theta = this.angle(p)
    return vec3(sin(theta).negate(), cos(theta), 0)
}

// Point on the smooth tube (no relief). The floor always stays at y = 0.
private basePoint(p: NodeV2): NodeV3 {
    const theta = this.angle(p)
    const radius = this.uniforms.radius
    return vec3(sin(theta).mul(radius), cos(theta).oneMinus().mul(radius), p.y.negate())
}
```

`p` is the **point of the flat plane** (`positionGeometry.xy`). Every helper takes that, so we can later call them with slightly shifted points.

> 💡 Why a dedicated `angle()` that only returns `p.x`? Because in the first version the plane was `2πR` wide and the angle was `p.x / R`. If you change that mapping one day, there's only one place to update.

In the constructor:

```ts
const planePosition = positionGeometry.xy
material.positionNode = this.basePoint(planePosition)
material.normalNode = transformNormalToView(this.inward(planePosition))
```

### ✅ Check
Exactly the same image as step 2. A refactor must not change anything visible.

---

## 4. First relief: noise pushed inward

The idea: **final point = smooth tube point + inward direction × height**, where the height comes from noise.

```ts
import { cos, mx_noise_float, positionGeometry, sin, transformNormalToView, uniform, vec3 } from 'three/tsl'

public uniforms = {
    radius: uniform(6),
    amplitude: uniform(0.8),
}

// How far the rock sticks out of the smooth tube at this point.
private rockHeight(base: NodeV3): NodeF {
    return mx_noise_float(base.mul(0.3)).mul(this.uniforms.amplitude)
}

// Final point: smooth tube + relief pushed toward the center.
private tunnelPoint(p: NodeV2): NodeV3 {
    const base = this.basePoint(p)
    return base.add(this.inward(p).mul(this.rockHeight(base)))
}
```

In the constructor:

```ts
material.positionNode = this.tunnelPoint(planePosition)
// Still the normal of the smooth tube: the lighting ignores the bumps (fixed in step 5).
material.normalNode = transformNormalToView(this.inward(planePosition))
```

### Explanations

**`mx_noise_float(position)`** is Perlin noise (it comes from MaterialX, hence the `mx_` prefix). For each point in space it returns a value that varies **smoothly**, roughly between **-1 and 1**. Two close points get close values, which is why it looks natural.

- **frequency / scale**: `base.mul(0.3)`. Multiplying the coordinates by a small number stretches the noise (big, soft shapes). A big number gives small, dense bumps. `0.3` means roughly one bump every 3 units.
- **amplitude**: `.mul(amplitude)`. How far the surface moves, in scene units (meters).

**Why sample the noise with `base` (3D) and not with the plane's `p` (2D)?**
1. **The seam.** The plane's two edges (x = -π and x = +π) meet at the ceiling. In 2D they are different coordinates, so different noise values, and you'd get a **crack** in the ceiling. In 3D they are the **same point**, so the same value and a perfect join.
2. **The scale stays physical.** In 3D, the noise is measured in meters. If you change the radius, the rocks keep their size instead of stretching.

**Why push along `inward`?** It's the direction perpendicular to the wall. Positive noise pushes toward the center (the rock sticks out), negative noise pushes into the mountain (a hollow).

### ✅ Check
The walls are bumpy. **But the lighting is still smooth, like plastic**: the edges of the bumps are visible against the background, while the light doesn't "see" them. That's normal. We're still using the smooth tube's normal. It's the perfect moment to understand why step 5 exists.

---

## 5. Recompute the normals (finite differences)

### The problem
Light depends on the **normal** (the direction the surface faces). The GPU doesn't recompute normals when we move vertices in the shader. We have to compute them ourselves.

### The technique: finite differences
We know how to compute the position of **any** point of the tunnel (`tunnelPoint`). So:

1. `p0` = the point here
2. `px` = the point a tiny bit further **around** the tube
3. `py` = the point a tiny bit further **along** the tube
4. `px - p0` and `py - p0` are two vectors **lying on the surface** (tangents)
5. their **cross product** is a vector **perpendicular** to both, which is the normal

```
          py
          ↑
          |   (surface)
    p0 ---+----→ px
          ⊙  normal = cross(px - p0, py - p0), pointing out of the screen
```

```ts
import { cos, cross, float, mx_noise_float, normalize, positionGeometry, sin, transformNormalToView, uniform, vec2, vec3 } from 'three/tsl'

// in the constructor, replace the normalNode:
const epsilon = 0.03
const p0 = this.tunnelPoint(planePosition)
// x is an angle: divide by the radius so the step is the same distance on both axes
const px = this.tunnelPoint(planePosition.add(vec2(float(epsilon).div(u.radius), 0)))
const py = this.tunnelPoint(planePosition.add(vec2(0, epsilon)))
const normal = normalize(cross(px.sub(p0), py.sub(p0)))
material.normalNode = transformNormalToView(normal)
```

### Explanations

**Why divide the step by the radius on x?**
On x, the plane coordinate is an **angle**. An angle step Δθ covers a **distance** of `R × Δθ` on the circle. To move 3 cm on both axes, we need `Δθ = 0.03 / R`. Otherwise, with a big radius, the step around the tube would be much longer than along it, and the lighting would be blurred in one direction only.

**Which way does the normal point?** At the floor (θ = 0): `px - p0` goes toward +X, and `py - p0` goes toward **-Z** (because of `negate()`!). `cross(+X, -Z) = +Y`, so it points **up, toward the inside**. ✅ That's consistent with the front face we chose in step 2. If you get the order wrong (`cross(py, px)`), the normal points into the mountain and everything looks lit from behind. Easy to spot.

**Why is it per pixel, and why does that matter?**
`normalNode` is evaluated in the **fragment shader**. When `positionGeometry` is used there, Three.js interpolates it between the triangle's 3 vertices. Since the original plane is flat, that interpolation is **exact**: every pixel knows its precise point on the plane. We then recompute the relief **at that exact point**, so the normals contain details **finer than the mesh** (small cracks lit correctly even inside one triangle).

**The cost:** each pixel of the tunnel computes the noise **3 times** (p0, px, py). With more complex noise (step 6) that's the most expensive part of the effect. If you need to optimize, you can compute the normal in the vertex shader instead and pass it on with `varying()`. It's cheaper, but you lose the fine details.

**`epsilon`:**
- too small (0.001) → floating-point precision problems, noisy normals
- too big (0.5) → blurry lighting, the small details disappear

In step 9 it becomes the `normalSmoothing` slider.

### ✅ Check
The bumps now catch the robot's light: lit on one side, shaded on the other. It already looks like a cave.

---

## 6. Real rock: 3 layers of noise

A single noise looks like a soft blob. Rock is a sum of scales: **big boulders + sharp ridges + small cracks**.

```ts
import { abs, mx_fractal_noise_float, mx_noise_float, pow, vec3 } from 'three/tsl'

private rockHeight(base: NodeV3): NodeF {
    // Big boulders
    const large = mx_fractal_noise_float(base.mul(0.12), 3)
    // Sharp ridges, squashed vertically to look like rock strata
    const ridgeCoords = base.mul(vec3(1, 3.7, 1)).mul(0.3)
    const ridges = pow(abs(mx_noise_float(ridgeCoords)).oneMinus(), 3)
    // Small cracks and chips
    const detail = mx_fractal_noise_float(base.mul(1.4), 3)

    return large.mul(1.6)
        .add(ridges.mul(0.8))
        .add(detail.mul(0.25))
        .mul(this.uniforms.amplitude)
}
```

### Layer 1: boulders, with fBm
`mx_fractal_noise_float(position, octaves, lacunarity = 2, diminish = 0.5)` is **fBm** (*fractal Brownian motion*): it adds several noises (**octaves**) on top of each other, each one:
- **twice as fine** (`lacunarity = 2`, the frequency doubles)
- **half as strong** (`diminish = 0.5`, the amplitude halves)

```
octave 1:  ~~~~~~~~~~~~~~~~~~~~~        big shapes
octave 2:  ~v~v~v~v~v~v~v~v~v~v~        medium
octave 3:  vvvvvvvvvvvvvvvvvvvvv        small
sum:       a natural, "rocky" silhouette
```

With 3 octaves and a very low frequency (`0.12`, about one boulder every 8 m), you get big masses that bulge into the tunnel.

### Layer 2: ridges (*ridged noise*)
Perlin noise crosses 0 smoothly. The trick:

```
n            = noise           → smooth waves between -1 and 1
abs(n)       = |noise|         → sharp V shapes at every zero crossing
1 - abs(n)   = oneMinus        → turned upside down: sharp PEAKS (ridges)
pow(…, 3)    = sharpness       → the peaks get thinner, the rest flattens
```

```
1 - |n|  :   /\    /\  /\      /\
            /  \  /  \/  \    /  \
pow(.,3) :   |      |  |       |       ← thin blades, like rock edges
          ___|______|__|_______|___
```

**The stretch `vec3(1, 3.7, 1)`**: we multiply the **y** coordinate by 3.7 before sampling, so the noise varies 3.7× faster vertically than horizontally. The ridges become **horizontal lines**, like the **strata** (layers) of sedimentary rock. That's the detail that makes it read as "mountain rock" rather than "clay".

### Layer 3: detail
High frequency (`1.4`), small amplitude (`0.25`): small cracks and chips. Most of it is visible **in the lighting** (thanks to step 5's per-pixel normals) more than in the silhouette.

### Summing
Each layer gets its own **strength** (1.6 / 0.8 / 0.25) and the sum is multiplied by the global amplitude. Changing the ratios gives very different rocks: more boulders makes a cave, more ridges makes a cliff, more detail makes crumbly rock.

### ✅ Check
Big masses, horizontal ridges, a finely grained surface. **Problem**: the floor is as rough as the walls, and the robot would fly through the rocks. That's step 7.

---

## 7. Flat floor, wild walls

We want a different amplitude depending on **where** we are around the tube. We have the perfect value for that: **the angle θ** (0 at the floor, ±π at the ceiling).

```ts
import { abs, mix, smoothstep } from 'three/tsl'

public uniforms = {
    radius: uniform(6),
    floorAmplitude: uniform(0.25),
    floorWidth: uniform(0.4),
    wallAmplitude: uniform(1.0),
    wallBlend: uniform(0.9),
}

private rockHeight(base: NodeV3, theta: NodeF): NodeF {
    const u = this.uniforms
    // ... the 3 layers from step 6 ...
    const height = large.mul(1.6).add(ridges.mul(0.8)).add(detail.mul(0.25))

    // Keep the floor mostly flat, let the walls and ceiling go wild.
    const wallMask = smoothstep(u.floorWidth, u.floorWidth.add(u.wallBlend), abs(theta))
    return height.mul(mix(u.floorAmplitude, u.wallAmplitude, wallMask))
}

private tunnelPoint(p: NodeV2): NodeV3 {
    const base = this.basePoint(p)
    const theta = this.angle(p)
    return base.add(this.inward(p).mul(this.rockHeight(base, theta)))
}
```

### Explanations

**`abs(theta)`**: the left and right walls are symmetric, so the distance to the floor is what matters, not the side.

**`smoothstep(edge0, edge1, x)`**: returns 0 when x < edge0 and 1 when x > edge1, with a **smooth** S-curve in between (not a straight line, so there's no visible "crease").

```
wallMask
 1 |                 ________   walls + ceiling
   |               /
   |             /     ← blend over wallBlend = 0.9 rad (~52°)
 0 |____________/
   0     floorWidth=0.4   1.3            π   |θ|
      (floor, ~23°)
```

**`mix(a, b, t)`**: linear blend, `a` when t = 0 and `b` when t = 1 (`a + (b - a) × t`). So the amplitude goes smoothly from `floorAmplitude` (0.25) to `wallAmplitude` (1.0).

**Why use the angle and not a distance?** It's the simplest thing: θ is already there. Side effect: `floorWidth` is an angle, so **the flat part of the floor gets wider as the radius grows**. If you want a fixed width in meters, compare the arc length `abs(theta).mul(radius)` against a width in meters instead.

### ✅ Check
A floor with gentle bumps, rough walls and ceiling, and a smooth transition between them.

---

## 8. Rock colors

```ts
import { color, varying } from 'three/tsl'

// in the constructor, after the normals:
const base = this.basePoint(planePosition)
const height = varying(this.rockHeight(base, this.angle(planePosition)))
const grain = mx_fractal_noise_float(base.mul(3.5), 3)
const tint = mx_noise_float(base.mul(0.15)).mul(0.5).add(0.5)

// 1. dark in the hollows, light on the bumps
const cavity = smoothstep(-1.2, 1.2, height.add(grain.mul(0.35)))
let rock = mix(color('#26221f'), color('#77706a'), cavity)
// 2. large brownish areas
rock = mix(rock, rock.mul(color('#a8805c')), tint.mul(0.6))
// 3. dust where the ground is flat
const dust = smoothstep(0.75, 0.95, normal.y)
material.colorNode = mix(rock, color('#7a7369'), dust.mul(0.35))
```

Remove `color: '#888888'` from the material: `colorNode` replaces it.

### Explanations

**`varying(node)`**: forces the node to be computed **in the vertex shader** (once per vertex) and then **interpolated** across the triangle for the pixels. The relief height is already computed in the vertex shader, and the colors don't need pixel precision for it, so it's much cheaper than computing the whole noise again for every pixel.

**1. Cavities.** Low `height` means a hollow (the rock goes into the mountain), so it's darker, like ambient occlusion: light gets into hollows less. `smoothstep(-1.2, 1.2, …)` maps heights from [-1.2, 1.2] to [0, 1]. We add a bit of `grain` (fine noise) so the dark/light boundary isn't too clean.

**2. Tint.** `noise × 0.5 + 0.5` brings the noise from [-1, 1] to [0, 1]. We **multiply** the color by a warm brown (`rock.mul(tint)`), like iron oxide stains in real rock. Multiplying keeps the light/dark contrast, which only adding a color wouldn't.

**3. Dust.** `normal.y` is the vertical component of the normal: 1 = facing straight up (horizontal ground), 0 = vertical wall, negative = ceiling. Dust settles where it's flat, so where `normal.y > 0.75`. We reuse the normal from step 5 (local space, which is also world space here because the mesh has no transform).

> 💡 Colors: `color('#26221f')` converts the hex (sRGB) to **linear** values, the working color space for lighting. Always go through `color()` or `THREE.Color` instead of writing `vec3(0.15, 0.13, 0.12)` by hand, or your colors will come out wrong.

### ✅ Check
A rock look: dark hollows, lighter edges, brown patches, dusty ground.

---

## 9. Tweaks: uniforms + lil-gui

Replace **every** hard-coded number you want to play with by a uniform:

```ts
public uniforms = {
    // Shape
    radius: uniform(6),

    // Relief
    floorAmplitude: uniform(0.25),
    floorWidth: uniform(0.4),
    wallAmplitude: uniform(1.0),
    wallBlend: uniform(0.9),
    largeScale: uniform(0.12),
    largeStrength: uniform(1.6),
    ridgeScale: uniform(0.3),
    ridgeStretch: uniform(3.7),
    ridgeSharpness: uniform(3),
    ridgeStrength: uniform(0.8),
    detailScale: uniform(1.4),
    detailStrength: uniform(0.25),
    normalSmoothing: uniform(0.03),

    // Colors
    darkColor: uniform(new THREE.Color('#26221f')),
    lightColor: uniform(new THREE.Color('#77706a')),
    cavityContrast: uniform(1.2),
    grainScale: uniform(3.5),
    grainStrength: uniform(0.35),
    tintColor: uniform(new THREE.Color('#a8805c')),
    tintScale: uniform(0.15),
    tintStrength: uniform(0.6),
    dustColor: uniform(new THREE.Color('#7a7369')),
    dustThreshold: uniform(0.75),
    dustStrength: uniform(0.35),
}
```

Then use them everywhere, for example `base.mul(u.largeScale)` instead of `base.mul(0.12)`, and `smoothstep(u.cavityContrast.negate(), u.cavityContrast, …)` instead of `smoothstep(-1.2, 1.2, …)`.

> ⚠️ The **octaves** (the `3` in `mx_fractal_noise_float(…, 3)`) stay constants: they set a number of loop iterations, and they're not something you tweak live.

### The GUI

```ts
import type GUI from 'lil-gui'

public debug(gui: GUI) {
    const u = this.uniforms
    const folder = gui.addFolder('tunnel')

    folder.add(u.radius, 'value', 2, 20, 0.01).name('radius')

    const floor = folder.addFolder('floor')
    floor.add(u.floorAmplitude, 'value', 0, 1, 0.01).name('amplitude')
    floor.add(u.floorWidth, 'value', 0, 1.5, 0.01).name('width')
    // ... one line per uniform, same pattern
    this.addColor(floor, u.dustColor, 'dustColor')
}

// lil-gui edits hex strings; the uniform holds a THREE.Color.
private addColor(folder: GUI, colorUniform: { value: THREE.Color }, name: string) {
    const proxy = { [name]: `#${colorUniform.value.getHexString()}` }
    folder.addColor(proxy, name).onChange((hex: string) => colorUniform.value.set(hex))
}
```

**Why `add(u.radius, 'value', …)`?** lil-gui modifies a **property of an object**. The uniform is an object, and its number lives in `.value`. When lil-gui changes `.value`, the shader receives the new value on the next frame.

**Why a proxy for colors?** `THREE.Color` stores **linear** values (see step 8), but a color picker works in sRGB. If you gave lil-gui the `Color` directly, it would display and edit the linear values, and the colors in the picker wouldn't match what you see. With a hex proxy: `getHexString()` converts back to sRGB for display, and `.set(hex)` converts to linear when you pick a color.

**Why is the radius live?** Thanks to step 1: the plane is 2π wide whatever the radius, and the radius only exists in the shader. Nothing to rebuild.

### ✅ Check
Every slider changes the tunnel instantly. Play with them: that's the best way to understand what each layer does.

---

## 10. Plug it into the world

In `src/worlds/CubeWorld.ts`, **remove the grid floor** (the `floor` mesh, the `grid` and their `dispose` lines) and replace it with the tunnel:

```ts
import Tunnel from '../objects/Tunnel'

private tunnel: Tunnel

// constructor
scene.background = new THREE.Color(FOG_COLOR)
scene.fog = new THREE.Fog(FOG_COLOR, 10, 55)

this.tunnel = new Tunnel(6, 200)
scene.add(this.tunnel.mesh)

this.robot = new Robot()
// Sideways: 40% of the radius, to stay away from the walls. Lengthwise: the tunnel minus a margin.
this.robot.bounds.set(this.tunnel.radius * 0.4, this.tunnel.length / 2 - 5)

// ... after the robot's GUI:
this.tunnel.debug(gui)

// update(), before this.robot.update(...)
// The tunnel radius can change live: keep the robot away from the walls
this.robot.bounds.x = this.tunnel.radius * 0.4

// dispose()
this.disposeObject(this.tunnel.mesh)
```

- **Fog**: the tunnel is 200 m long. Without fog you'd see its open end. `Fog(color, 10, 55)` fades everything to the background color between 10 and 55 m. That hides the end and adds depth. The background uses **the same color**, so the blend is seamless.
- **Robot bounds**: the robot doesn't collide with the rock. We simply stop it from going too far sideways (`radius × 0.4`) and lengthwise.
- **Lights**: the robot's `PointLight` (its headlight) does most of the work. A dim ambient light and a directional light keep the far parts from being pure black.

### ✅ Check
You fly through a rock tunnel. 🎉

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The tunnel is invisible from inside | Faces are backwards: check the `negate()` on z (step 2), or use `side: THREE.DoubleSide` to test |
| Everything looks lit from behind / inverted | Normal in the wrong direction: swap the `cross()` arguments (step 5) |
| A crack in the ceiling | Noise sampled with the 2D plane coordinates instead of `base` (3D) (step 4) |
| Relief made of big flat triangles | Not enough segments in `PlaneGeometry` |
| Lighting too "plastic", no visible cracks | Normals still from the smooth tube, or `normalSmoothing` too high |
| Noisy / flickering lighting | `normalSmoothing` too low (floating-point precision) |
| The tunnel disappears at some angles | `frustumCulled` is still `true` |
| Wrong colors in the GUI | Color given to lil-gui without the hex proxy (step 9) |
| TS error `Node<"vec2"> is not assignable to VarNode…` | Type your helpers with `THREE.Node<'vec2'>`, not `ReturnType<typeof vec2>` |

## Going further

1. **A winding tunnel**: add `sin(z × 0.05) × 4` to x in `basePoint`. Warning: the robot would also need to follow the curve.
2. **Stalactites**: on the ceiling only (a mask on `abs(theta)` close to π), add a very stretched noise pointing down.
3. **Wet rock**: lower `roughness` in the hollows using `material.roughnessNode = mix(0.3, 0.95, cavity)`.
4. **Snow on the floor** (it's a snow project after all!): replace the dust with white, and use `normal.y` + noise for the patches. For snow with real volume, follow `SNOW.md`.
5. **Optimization**: compute the normal in the vertex shader (`varying`) and compare the FPS.
6. **An infinite tunnel**: move the mesh with the robot and add the robot's position to the noise coordinates.

## Glossary

- **Node**: a building block of the shader graph (a value, an operation, a function). TSL assembles nodes; Three.js compiles them.
- **Uniform**: a value sent from JS to the GPU, the same for every vertex / pixel, and changeable every frame.
- **Varying**: a value computed in the vertex shader and interpolated for each pixel.
- **Normal**: a unit vector perpendicular to the surface. Lighting depends on it.
- **View space**: the coordinate system relative to the camera, where Three.js computes lighting.
- **Winding**: the order of a triangle's vertices, which defines its front face.
- **Frustum culling**: skipping objects outside the camera's view.
- **Perlin noise**: a smooth pseudo-random function in [-1, 1].
- **fBm / octaves**: a sum of noises at increasing frequencies and decreasing amplitudes.
- **Ridged noise**: `1 - |noise|`, which turns zero crossings into sharp ridges.
- **smoothstep / mix**: smooth S-shaped threshold / linear blend between two values.
- **Finite differences**: approximating a derivative (here, the tangents) by comparing a function at very close points.
