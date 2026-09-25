import * as THREE from 'three/webgpu'
import {
    uniform, positionGeometry, vec3, sin, cos, smoothstep, mix, abs, pow, max, float,
    transformNormalToView, mx_noise_float, mx_fractal_noise_float, vec2, normalize,
    cross, varying
} from 'three/tsl'
import type GUI from 'lil-gui'

type NodeF = THREE.Node<'float'>
type NodeV2 = THREE.Node<'vec2'>
type NodeV3 = THREE.Node<'vec3'>


export default class RockTunnel {

    public mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>
    public readonly length: number
    public uniforms = {
        // Shape
        radius: uniform(13),

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

        // Roughness varies with a noise so some places look icy (shinier)
        roughnessIce: uniform(0.8),
        roughnessRock: uniform(1),
        roughnessNoiseFrequency: uniform(0.08),

        // Snow
        snowThickness: uniform(2),
        snowSlope: uniform(0.35),
        snowSlopeBlend: uniform(0.3),
        snowDriftScale: uniform(0.305),
        snowSoftness: uniform(1),
        snowColor: uniform(new THREE.Color('#f2f5fa')),
        snowRoughness: uniform(0.8),
    }


    private getTheta(p: NodeV2): NodeF {
        return p.x
    }
    private inward(p: NodeV2): NodeV3 {
        const theta = this.getTheta(p)
        return vec3(sin(theta).negate(), cos(theta), 0)
    }

    private basePoint(p: NodeV2): NodeV3 {
        const theta = this.getTheta(p)
        const radius = this.uniforms.radius
        return vec3(sin(theta).mul(radius), cos(theta).oneMinus().mul(radius), p.y.negate())
    }

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

    /**
     * Height of the snow surface: it follows the boulders only (no ridges, no cracks),
     * so wherever it's above the rock, it fills the cracks and smooths everything.
     */
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

    // Like max(a, b), but rounded where a and b are closer than k
    private smoothMax(a: NodeF, b: NodeF, k: NodeF): NodeF {
        const h = max(k.sub(abs(a.sub(b))), 0).div(k)
        return max(a, b).add(h.mul(h).mul(k).mul(0.25))
    }

    private surface(p: NodeV2) {
        const base = this.basePoint(p)
        const boulders = this.boulders(base)
        const rock = this.rockHeight(base, boulders)
        const snow = this.snowHeight(base, p, boulders)
        const height = this.smoothMax(rock, snow, this.uniforms.snowSoftness)
        return { base, rock, height }
    }

    private tunnelPoint(p: NodeV2): NodeV3 {
        const { base, height } = this.surface(p)
        return base.add(this.inward(p).mul(height))
    }



    constructor() {
        this.length = 200
        const u = this.uniforms
        const geometry = new THREE.PlaneGeometry(Math.PI * 2, this.length, 320, 900)
        const material = new THREE.MeshStandardNodeMaterial({
            metalness: 0,
        })

        const planePosition = positionGeometry.xy

        material.positionNode = this.tunnelPoint(planePosition)


        /**
         * Recalculate the normals :D
         *
         * p0: the point here
         * px: the point a tiny bit further around the tube
         * py: the point a tiny bit further along the tube
         */
        const p0 = this.tunnelPoint(planePosition)
        const px = this.tunnelPoint(planePosition.add(vec2(u.normalSmoothing.div(u.radius), 0)))
        const py = this.tunnelPoint(planePosition.add(vec2(0, u.normalSmoothing)))

        // Local space normal (reused for the dust), converted to view space for the lighting
        const normal = normalize(cross(px.sub(p0), py.sub(p0)))
        material.normalNode = transformNormalToView(normal)


        /**
         * Let's color this
         */
        const surface = this.surface(planePosition)
        const base = surface.base
        const height = varying(surface.rock)
        // How much snow sits on top of the rock (0 = bare rock)
        const snowDepth = varying(surface.height.sub(surface.rock))

        const grain = mx_fractal_noise_float(base.mul(u.grainScale), 3)
        const tint = mx_noise_float(base.mul(u.tintScale)).mul(0.5).add(0.5)

        const cavity = smoothstep(u.cavityContrast.negate(), u.cavityContrast, height.add(grain.mul(u.grainStrength)))
        let rock = mix(u.darkColor, u.lightColor, cavity)
        rock = mix(rock, rock.mul(u.tintColor), tint.mul(u.tintStrength))

        const dust = smoothstep(u.dustThreshold, u.dustThreshold.add(0.2), normal.y)
        rock = mix(rock, u.dustColor, dust.mul(u.dustStrength))

        // A few centimeters of snow are enough to hide the rock
        const snowMask = smoothstep(0.02, 0.1, snowDepth)
        material.colorNode = mix(rock, u.snowColor, snowMask)


        /**
         * Ice: mx_noise_float returns roughly [-1, 1], remapped to [0, 1]
         */
        const iceNoise = mx_noise_float(base.mul(u.roughnessNoiseFrequency))
            .mul(0.5)
            .add(0.5)
            .clamp()
        const roughness = mix(u.roughnessIce, u.roughnessRock, iceNoise)
        material.roughnessNode = mix(roughness, u.snowRoughness, snowMask)

        // Debug: roughness displayed in the red channel
        // material.colorNode = vec3(roughness, 0, 0)

        // Debug: snow depth displayed in the red channel
        // material.colorNode = vec3(snowDepth, 0, 0)


        this.mesh = new THREE.Mesh(geometry, material)
        this.mesh.frustumCulled = false
    }

    public get radius() {
        return this.uniforms.radius.value
    }



    public debug(gui: GUI) {
        const u = this.uniforms
        const folder = gui.addFolder('rock')

        folder.add(u.radius, 'value', 2, 30, 0.01).name('radius')

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
        relief.add(u.detailScale, 'value', 0.1, 6, 0.01).name('cracksScale')
        relief.add(u.detailStrength, 'value', 0, 1, 0.01).name('cracksStrength')
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
        colors.add(u.roughnessIce, 'value', 0, 1, 0.01).name('roughnessIce')
        colors.add(u.roughnessRock, 'value', 0, 1, 0.01).name('roughnessRock')
        colors.add(u.roughnessNoiseFrequency, 'value', 0.005, 1, 0.001).name('roughnessNoiseFrequency')
        colors.add(this.mesh.material, 'metalness', 0, 1, 0.01)

        const snow = folder.addFolder('snow')
        snow.add(u.snowThickness, 'value', 0, 4, 0.01).name('thickness')
        snow.add(u.snowSlope, 'value', -1, 1, 0.01).name('slope')
        snow.add(u.snowSlopeBlend, 'value', 0.01, 1, 0.01).name('slopeBlend')
        snow.add(u.snowDriftScale, 'value', 0.01, 0.5, 0.001).name('driftScale')
        snow.add(u.snowSoftness, 'value', 0.01, 2, 0.01).name('softness')
        snow.add(u.snowRoughness, 'value', 0, 1, 0.01).name('roughness')
        this.addColor(snow, u.snowColor, 'color')

        return folder
    }

    // lil-gui edits hex strings; the uniform holds a THREE.Color (linear).
    private addColor(folder: GUI, colorUniform: { value: THREE.Color }, name: string) {
        const proxy = { [name]: `#${colorUniform.value.getHexString()}` }
        folder.addColor(proxy, name).onChange((hex: string) => colorUniform.value.set(hex))
    }
}
