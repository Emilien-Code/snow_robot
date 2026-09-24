import * as THREE from 'three/webgpu'
import {
    uniform, vec3, mix, smoothstep, pow, length, fwidth, luminance,
    positionLocal, positionWorld, normalWorld, mx_noise_float, mx_fractal_noise_float,
} from 'three/tsl'
import type GUI from 'lil-gui'

/**
 * GENERATED WITH CLAUDE FROM BLENDER NODES MATERIALS
 */
// Worn plastic, ported from a Blender shader graph: darker edges, dirt underneath,
// patches where the color is faded, and roughness driven by the edges + a noise.
// All the materials created by one instance share its uniforms, only the base color differs.
export default class PlasticMaterial {
    public uniforms = {
        edgeColor: uniform(new THREE.Color(0x8a5a3c)),
        dirtColor: uniform(new THREE.Color(0x7a4a33)),
        fadeColor: uniform(new THREE.Color(0xeee9df)),

        edgeSharpness: uniform(1.0),
        edgeRampPos: uniform(0.4),

        dirtScale: uniform(3.0),
        dirtGamma: uniform(1.0),
        dirtRampPos: uniform(0.96),

        fadeScale: uniform(2.0),
        fadeThreshold: uniform(0.45),
        fadeSoftness: uniform(0.35),
        fadeDesaturate: uniform(0.6),
        fadeStrength: uniform(0.35),

        roughNoiseScale: uniform(5.0),
        roughMixFactor: uniform(0.293),
        roughRampPos: uniform(0.729),
    }

    private name: string
    private baseColors: Record<string, { value: THREE.Color }> = {}

    // `name` is the GUI folder name
    constructor(name = 'plastic') {
        this.name = name
    }

    public create(name: string, baseColor: THREE.ColorRepresentation) {
        const u = this.uniforms
        const baseUniform = uniform(new THREE.Color(baseColor))
        this.baseColors[name] = baseUniform
        const base = baseUniform.rgb

        // Masks (noises remapped from [-1, 1] to [0, 1])
        const curvature = length(fwidth(normalWorld)).div(length(fwidth(positionWorld)).max(1e-5))
        const edgeBreakup = mx_fractal_noise_float(positionLocal.mul(8), 3).mul(0.5).add(0.5)
        const edgeMask = curvature.mul(u.edgeSharpness).mul(0.05).mul(edgeBreakup).clamp()

        const facingDown = normalWorld.y.mul(-0.5).add(0.5)
        const grunge = mx_fractal_noise_float(positionLocal.mul(u.dirtScale), 4).mul(0.5).add(0.5)
        const dirtMask = facingDown.mul(grunge).clamp()

        const roughMask = mx_noise_float(positionLocal.mul(u.roughNoiseScale)).mul(0.5).add(0.5)

        const fadeNoise = mx_fractal_noise_float(positionLocal.mul(u.fadeScale), 3).mul(0.5).add(0.5)
        const fadeMask = smoothstep(u.fadeThreshold.sub(u.fadeSoftness), u.fadeThreshold.add(u.fadeSoftness), fadeNoise)

        // Color: base -> darker edges -> dirt -> faded patches
        const edgeFac = edgeMask.div(u.edgeRampPos).clamp()
        let color = mix(base, base.mul(u.edgeColor.rgb), edgeFac)

        const dirtFac = pow(dirtMask, u.dirtGamma).add(roughMask).div(u.dirtRampPos).clamp().oneMinus()
        color = mix(color, color.mul(u.dirtColor.rgb), dirtFac)

        const washed = mix(mix(color, vec3(luminance(color)), u.fadeDesaturate), u.fadeColor.rgb, 0.5)
        color = mix(color, washed, fadeMask.mul(u.fadeStrength).clamp())

        const material = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, metalness: 0, ior: 1.5 })
        material.name = name
        material.colorNode = color
        material.roughnessNode = mix(edgeMask, roughMask, u.roughMixFactor).div(u.roughRampPos).clamp()
        return material
    }

    public debug(gui: GUI) {
        const u = this.uniforms
        const folder = gui.addFolder(this.name).close()

        // lil-gui edits hex strings; the uniforms hold a THREE.Color (linear)
        const colors = { ...this.baseColors, edgeColor: u.edgeColor, dirtColor: u.dirtColor, fadeColor: u.fadeColor }
        for (const [name, colorUniform] of Object.entries(colors)) {
            const proxy = { [name]: `#${colorUniform.value.getHexString()}` }
            folder.addColor(proxy, name).onChange((hex: string) => colorUniform.value.set(hex))
        }

        const sliders: [keyof typeof u, number, number][] = [
            ['edgeSharpness', 0, 10], ['edgeRampPos', 0.001, 1],
            ['dirtScale', 0.1, 20], ['dirtGamma', 0.1, 5], ['dirtRampPos', 0.001, 2],
            ['fadeStrength', 0, 1], ['fadeScale', 0.1, 20], ['fadeThreshold', 0, 1],
            ['fadeSoftness', 0.01, 1], ['fadeDesaturate', 0, 1],
            ['roughNoiseScale', 0.1, 30], ['roughMixFactor', 0, 1], ['roughRampPos', 0.001, 1],
        ]
        for (const [key, min, max] of sliders) folder.add(u[key], 'value', min, max, 0.001).name(key)

        return folder
    }
}
