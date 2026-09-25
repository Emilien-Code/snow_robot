import * as THREE from 'three/webgpu'
import {
    uniform, positionGeometry, vec3, sin, cos, smoothstep, mix, abs, pow,
    transformNormalToView, mx_noise_float, mx_fractal_noise_float, vec2, normalize,
    cross, varying, float,
    max,
    mx_noise_vec3,
    uv
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



        // SNOW 
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

    private rockHeight(base: NodeV3, theta: NodeF): NodeF {
        const u = this.uniforms

        /**
         * Let's create the rocks BAAABYYYYY
         */

        // Big rock
        const largeRock = mx_fractal_noise_float(base.mul(u.largeScale), 3).mul(u.largeStrength)

        // Sharp rock
        const ridgeCoords = base.mul(vec3(1, u.ridgeStretch, 1)).mul(u.ridgeScale)
        const sharpRock = pow(abs(mx_noise_float(ridgeCoords)).oneMinus(), u.ridgeSharpness).mul(u.ridgeStrength)

        // Small rock
        const cracks = mx_fractal_noise_float(base.mul(u.detailScale), 3).mul(u.detailStrength)

        const height = largeRock
            .add(sharpRock)
            .add(cracks)

        // const wallMask = smoothstep(u.floorWidth, u.floorWidth.add(u.wallBlend), abs(theta))
        return height//.mul(mix(u.floorAmplitude, u.wallAmplitude, wallMask))
    }


    private surface(p: NodeV2) {

        const base = this.basePoint(p)
        const rock = this.rockHeight(base, float(0))

        const snow = this.snowHeight(base, p)
        const height = this.smoothWMax(rock, snow, this.uniforms.snowSoftness)

        return {
            base, rock, height
        }
    }

    smoothWMax(a: any, b: any, k: any) {
        const h = max(k.sub(abs(a.sub(b))), 0).div(k)
        return max(a, b).add(h.mul(h).mul(k).mul(0.25))
    }

    private snowHeight(base: NodeV3, p: NodeV2,) {
        const u = this.uniforms
        const largeRock = mx_fractal_noise_float(base.mul(u.largeScale), 3).mul(u.largeStrength)

        const testUp = this.inward(p).y
        const coverage = smoothstep(u.snowSlope, u.snowSlope.add(u.snowSlopeBlend), testUp)

        const drift = mx_noise_float(base.mul(u.snowDriftScale)).mul(0.5).add(0.5)

        const amount = coverage.mul(drift)


        return largeRock.add(mix(float(-1), this.uniforms.snowThickness, amount))

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
            roughness: 0.95,
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


        const snowMask = smoothstep(0.02, 0.1, snowDepth)

        material.colorNode = mix(rock, u.snowColor, snowMask)


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
        colors.add(this.mesh.material, 'roughness', 0, 1, 0.01)
        colors.add(this.mesh.material, 'metalness', 0, 1, 0.01)

        return folder
    }

    // lil-gui edits hex strings; the uniform holds a THREE.Color (linear).
    private addColor(folder: GUI, colorUniform: { value: THREE.Color }, name: string) {
        const proxy = { [name]: `#${colorUniform.value.getHexString()}` }
        folder.addColor(proxy, name).onChange((hex: string) => colorUniform.value.set(hex))
    }
}
