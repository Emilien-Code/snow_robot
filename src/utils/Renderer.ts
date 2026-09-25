import * as THREE from 'three/webgpu'
import { Inspector } from 'three/addons/inspector/Inspector.js'
import type Experience from '../Experience'
import GUI from 'lil-gui'
import { pass, mrt, output, normalView, uniform, directionToColor, colorToDirection, sample, screenUV, smoothstep, float, vec4, packNormalToRGB, unpackRGBToNormal, vec3, mix, renderOutput, luminance, saturation } from 'three/tsl'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'

type View = 'final' | 'normal' | "ao" | 'bloom' | "default"

export default class Renderer {
    public instance: THREE.WebGPURenderer
    public initialized = false

    private experience: Experience
    private pipeline: THREE.RenderPipeline
    private bloomPass: ReturnType<typeof bloom>
    private aoPass: ReturnType<typeof ao>

    private views: Record<View, THREE.Node>
    private params = { view: 'final' as View }


    public uniforms = {
        aoIntensity: uniform(1),

        fogNear: uniform(10),
        fogFar: uniform(55),

        exposure: uniform(1),
        shadowTint: uniform(new THREE.Color('#9fb4d6')),
        shadowTintStrength: uniform(0.35),

        saturation: uniform(1.05),
        vignetteStart: uniform(0.35),
        vignetteEnd: uniform(0.85),
        vignetteStrength: uniform(0.35),
        grain: uniform(0.08),
    }

    constructor(experience: Experience) {
        this.experience = experience

        this.instance = new THREE.WebGPURenderer({
            canvas: experience.canvas,
            antialias: true,
        })
        this.instance.toneMapping = THREE.ACESFilmicToneMapping
        this.instance.shadowMap.enabled = true
        this.instance.shadowMap.type = THREE.PCFSoftShadowMap



        this.instance.setClearColor(0xc9cdd3, 1)
        this.resize()

        const folder = experience.helpers.GUI.addFolder('renderer')
        const clearProxy = { clearColor: `#${this.instance.getClearColor(new THREE.Color()).getHexString()}` }
        folder.addColor(clearProxy, 'clearColor').onChange((hex: string) => this.instance.setClearColor(hex))

        if (experience.helpers.active) {
            const inspector = new Inspector()
            this.instance.inspector = inspector
            window.addEventListener('keydown', (event) => {
                if (event.key.toLowerCase() === 'h') inspector.setVisible(!inspector.getVisible())
            })
        }

        this.createPipeline()


        this.instance.init().then(() => {
            this.initialized = true
        })
    }


    private createPipeline() {
        const { scene } = this.experience
        const camera = this.experience.camera.instance

        const fristPass = pass(scene, camera, { samples: 0 })
        const scenePass = fristPass

        const sceneMRT = mrt({
            output,
            normal: vec4(packNormalToRGB(normalView), 1),
        })
        sceneMRT.setBlendMode('normal', new THREE.BlendMode(THREE.MaterialBlending))

        scenePass.setMRT(sceneMRT)

        const sceneColor = scenePass.getTextureNode('output')
        const sceneNormalTexture = scenePass.getTextureNode('normal')


        const sceneDepth = scenePass.getTextureNode('depth')
        const sceneNormal = sample((uv) => unpackRGBToNormal(sceneNormalTexture.sample(uv).xyz))



        /**
         * AO
         */
        const aoPass = ao(sceneDepth, sceneNormal, camera)
        aoPass.resolutionScale = 0.5
        aoPass.radius.value = 1
        this.aoPass = aoPass
        const aoRaw = aoPass.getTextureNode().r

        const lit = sceneColor.rgb.mul(mix(float(1), aoRaw, this.uniforms.aoIntensity))




        /**
         * BLOOM
         */
        const bloomPass = bloom(vec4(lit, 1), 0.25, 0.4, 0.9)
        this.bloomPass = bloomPass
        const withBloom = lit.add(bloomPass.rgb)


        /**
         * EXPOSURE
         */

        const exposed = withBloom.mul(this.uniforms.exposure)
        const shadows = smoothstep(0.4, 0, luminance(exposed)).mul(this.uniforms.shadowTintStrength)
        const graded = mix(exposed, exposed.mul(this.uniforms.shadowTint), shadows)



        /**
         * TONE MAPPING
         */

        const display = renderOutput(vec4(graded, 1))

        /**
         * Vignette + tests
         */


        const saturated = saturation(display.rgb, this.uniforms.saturation)
        const vignette = smoothstep(this.uniforms.vignetteStart, this.uniforms.vignetteEnd, screenUV.distance(0.5)).mul(this.uniforms.vignetteStrength)
        const vignetted = saturated.mul(vignette.oneMinus())

        /**
         * ANTI ALIASING
         */
        const antialiased = smaa(vec4(vignetted, 1))
        const final = film(antialiased, this.uniforms.grain)

        this.views = {
            final,
            normal: vec4(sceneNormalTexture.rgb, 1),
            ao: vec4(vec3(aoRaw), 1),
            bloom: vec4(bloomPass.rgb, 1),
            default: fristPass
        }




        this.pipeline = new THREE.RenderPipeline(this.instance)
        this.pipeline.outputColorTransform = false
        this.pipeline.outputNode = this.views.final

        this.aoPass = aoPass
        this.bloomPass = bloomPass
    }


    private setView(view: View) {
        this.pipeline.outputNode = this.views[view]
        this.pipeline.needsUpdate = true
    }

    public debug(gui: GUI) {
        const folder = gui.addFolder('postprocessing')
        folder.add(this.params, 'view', ['final', 'normal', "ao", "bloom", "default"]).onChange((view: View) => this.setView(view))


        folder.add(this.uniforms.exposure, 'value', 0, 1, 0.01).name('exposure')


        const aoFolder = folder.addFolder('ao')
        aoFolder.add(this.uniforms.aoIntensity, 'value', 0, 1, 0.01).name('intensity')
        aoFolder.add(this.aoPass.radius, 'value', 0.05, 2, 0.01).name('radius')
        aoFolder.add(this.aoPass.thickness, 'value', 0.1, 5, 0.01).name('thickness')
        aoFolder.add(this.aoPass.scale, 'value', 0, 3, 0.01).name('scale')

        const bloomFolder = folder.addFolder('bloom')
        bloomFolder.add(this.bloomPass.strength, 'value', 0, 2, 0.01).name('strength')
        bloomFolder.add(this.bloomPass.radius, 'value', 0, 1, 0.01).name('radius')
        bloomFolder.add(this.bloomPass.threshold, 'value', 0, 2, 0.01).name('threshold')
    }

    public resize() {
        const { width, height, pixelRatio } = this.experience.sizes
        this.instance.setSize(width, height)
        this.instance.setPixelRatio(pixelRatio)
    }

    public update() {
        if (!this.initialized) return


        const fog = this.experience.scene.fog
        if (fog instanceof THREE.Fog) {
            this.uniforms.fogNear.value = fog.near
            this.uniforms.fogFar.value = fog.far
        }

        this.pipeline.render()
    }
}
