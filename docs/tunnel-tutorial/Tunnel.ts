// Reference solution of the tunnel tutorial (docs/tunnel-tutorial/README.md).
// To use it: copy this file to src/objects/Tunnel.ts and follow step 10 of the tutorial.
import * as THREE from 'three/webgpu'
import type GUI from 'lil-gui'
import {
    abs, cos, cross, mix, mx_fractal_noise_float, mx_noise_float, normalize, positionGeometry,
    pow, sin, smoothstep, transformNormalToView, uniform, varying, vec2, vec3,
} from 'three/tsl'

type NodeF = THREE.Node<'float'>
type NodeV2 = THREE.Node<'vec2'>
type NodeV3 = THREE.Node<'vec3'>

// A plane rolled into a tube around the Z axis, with rocky relief pushed inward.
// Everything happens in the shader: the plane's x is the angle around the tube, y runs along it.
export default class Tunnel {
    public mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>

    public readonly length: number

    // Every tweakable value of the shader. Changing `.value` updates it live.
    public uniforms = {
        // Shape
        radius: uniform(6),

        // Relief
        floorAmplitude: uniform(0.25),
        floorWidth: uniform(0.4), // angle (radians) where the floor starts turning into walls
        wallAmplitude: uniform(1.0),
        wallBlend: uniform(0.9), // angle over which floor and walls blend
        largeScale: uniform(0.12),
        largeStrength: uniform(1.6),
        ridgeScale: uniform(0.3),
        ridgeStretch: uniform(3.7), // vertical squash of the ridges (rock strata)
        ridgeSharpness: uniform(3),
        ridgeStrength: uniform(0.8),
        detailScale: uniform(1.4),
        detailStrength: uniform(0.25),
        normalSmoothing: uniform(0.03), // bigger = softer lighting, smaller = crisper details

        // Colors
        darkColor: uniform(new THREE.Color('#26221f')),
        lightColor: uniform(new THREE.Color('#77706a')),
        cavityContrast: uniform(1.2), // range of height mapped from dark to light (smaller = harsher)
        grainScale: uniform(3.5),
        grainStrength: uniform(0.35),
        tintColor: uniform(new THREE.Color('#a8805c')),
        tintScale: uniform(0.15),
        tintStrength: uniform(0.6),
        dustColor: uniform(new THREE.Color('#7a7369')),
        dustThreshold: uniform(0.75), // how flat the ground must be to get dust
        dustStrength: uniform(0.35),
    }

    constructor(radius = 6, length = 200) {
        this.length = length
        const u = this.uniforms
        u.radius.value = radius

        // Width = 2π: x is directly the angle, so the radius can change without rebuilding the geometry.
        const geometry = new THREE.PlaneGeometry(Math.PI * 2, length, 320, 900)
        const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 })

        const planePosition = positionGeometry.xy

        // Vertex: displaced tunnel position.
        material.positionNode = this.tunnelPoint(planePosition)

        // Fragment: normals recomputed per pixel from the displacement (finite differences),
        // since moving the vertices does not update the geometry normals.
        const p0 = this.tunnelPoint(planePosition)
        // x is an angle: divide by the radius so the step is the same distance on both axes
        const px = this.tunnelPoint(planePosition.add(vec2(u.normalSmoothing.div(u.radius), 0)))
        const py = this.tunnelPoint(planePosition.add(vec2(0, u.normalSmoothing)))
        const normal = normalize(cross(px.sub(p0), py.sub(p0)))
        material.normalNode = transformNormalToView(normal)

        // Rock color: dark in the cavities, lighter on the bumps, dusty where the ground is flat.
        const base = this.basePoint(planePosition)
        const height = varying(this.rockHeight(base, this.angle(planePosition)))
        const grain = mx_fractal_noise_float(base.mul(u.grainScale), 3)
        const tint = mx_noise_float(base.mul(u.tintScale)).mul(0.5).add(0.5)

        const cavity = smoothstep(u.cavityContrast.negate(), u.cavityContrast, height.add(grain.mul(u.grainStrength)))
        let rock = mix(u.darkColor, u.lightColor, cavity)
        rock = mix(rock, rock.mul(u.tintColor), tint.mul(u.tintStrength))
        const dust = smoothstep(u.dustThreshold, u.dustThreshold.add(0.2), normal.y)
        material.colorNode = mix(rock, u.dustColor, dust.mul(u.dustStrength))

        this.mesh = new THREE.Mesh(geometry, material)
        // The geometry bounding box is the flat plane, not the tunnel.
        this.mesh.frustumCulled = false
    }

    public get radius() {
        return this.uniforms.radius.value
    }

    public debug(gui: GUI) {
        const u = this.uniforms
        const folder = gui.addFolder('tunnel')

        folder.add(u.radius, 'value', 2, 20, 0.01).name('radius')

        const floor = folder.addFolder('floor')
        floor.add(u.floorAmplitude, 'value', 0, 1, 0.01).name('amplitude')
        floor.add(u.floorWidth, 'value', 0, 1.5, 0.01).name('width')
        floor.add(u.dustThreshold, 'value', 0, 1, 0.01).name('dustThreshold')
        floor.add(u.dustStrength, 'value', 0, 1, 0.01).name('dustStrength')
        this.addColor(floor, u.dustColor, 'dustColor')

        const walls = folder.addFolder('walls')
        walls.add(u.wallAmplitude, 'value', 0, 3, 0.01).name('amplitude')
        walls.add(u.wallBlend, 'value', 0.05, 2, 0.01).name('floorToWallBlend')

        const relief = folder.addFolder('relief').close()
        relief.add(u.largeScale, 'value', 0.01, 0.5, 0.001).name('boulderScale')
        relief.add(u.largeStrength, 'value', 0, 4, 0.01).name('boulderStrength')
        relief.add(u.ridgeScale, 'value', 0.05, 2, 0.01).name('ridgeScale')
        relief.add(u.ridgeStretch, 'value', 1, 10, 0.01).name('ridgeStretch')
        relief.add(u.ridgeSharpness, 'value', 1, 8, 0.01).name('ridgeSharpness')
        relief.add(u.ridgeStrength, 'value', 0, 3, 0.01).name('ridgeStrength')
        relief.add(u.detailScale, 'value', 0.1, 6, 0.01).name('detailScale')
        relief.add(u.detailStrength, 'value', 0, 1, 0.01).name('detailStrength')
        relief.add(u.normalSmoothing, 'value', 0.005, 0.3, 0.001).name('normalSmoothing')

        const colors = folder.addFolder('colors').close()
        this.addColor(colors, u.darkColor, 'darkColor')
        this.addColor(colors, u.lightColor, 'lightColor')
        colors.add(u.cavityContrast, 'value', 0.1, 4, 0.01).name('cavityRange')
        colors.add(u.grainScale, 'value', 0.1, 10, 0.01).name('grainScale')
        colors.add(u.grainStrength, 'value', 0, 2, 0.01).name('grainStrength')
        this.addColor(colors, u.tintColor, 'tintColor')
        colors.add(u.tintScale, 'value', 0.01, 1, 0.001).name('tintScale')
        colors.add(u.tintStrength, 'value', 0, 1, 0.01).name('tintStrength')
        colors.add(this.mesh.material, 'roughness', 0, 1, 0.01)
        colors.add(this.mesh.material, 'metalness', 0, 1, 0.01)
    }

    // lil-gui edits hex strings; the uniform holds a THREE.Color.
    private addColor(folder: GUI, colorUniform: { value: THREE.Color }, name: string) {
        const proxy = { [name]: `#${colorUniform.value.getHexString()}` }
        folder.addColor(proxy, name).onChange((hex: string) => colorUniform.value.set(hex))
    }

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

    // Relief height, sampled in 3D so the seam at the ceiling stays continuous.
    private rockHeight(base: NodeV3, theta: NodeF): NodeF {
        const u = this.uniforms

        // Big boulders
        const large = mx_fractal_noise_float(base.mul(u.largeScale), 3)
        // Sharp ridges, squashed vertically to look like rock strata
        const ridgeCoords = base.mul(vec3(1, u.ridgeStretch, 1)).mul(u.ridgeScale)
        const ridges = pow(abs(mx_noise_float(ridgeCoords)).oneMinus(), u.ridgeSharpness)
        // Small cracks and chips
        const detail = mx_fractal_noise_float(base.mul(u.detailScale), 3)

        const height = large.mul(u.largeStrength)
            .add(ridges.mul(u.ridgeStrength))
            .add(detail.mul(u.detailStrength))

        // Keep the floor mostly flat, let the walls and ceiling go wild.
        const wallMask = smoothstep(u.floorWidth, u.floorWidth.add(u.wallBlend), abs(theta))
        return height.mul(mix(u.floorAmplitude, u.wallAmplitude, wallMask))
    }

    private tunnelPoint(p: NodeV2): NodeV3 {
        const base = this.basePoint(p)
        const theta = this.angle(p)
        return base.add(this.inward(p).mul(this.rockHeight(base, theta)))
    }
}
