import * as THREE from 'three/webgpu'
import type Experience from '../Experience'

export default class Renderer {
    public instance: THREE.WebGPURenderer
    // WebGPURenderer needs an async init() before the first render.
    public initialized = false

    private experience: Experience

    constructor(experience: Experience) {
        this.experience = experience

        // Uses WebGPU when available, falls back to WebGL2 otherwise.
        this.instance = new THREE.WebGPURenderer({
            canvas: experience.canvas,
            antialias: true,
        })
        this.instance.toneMapping = THREE.ACESFilmicToneMapping
        this.instance.shadowMap.enabled = true
        this.instance.shadowMap.type = THREE.PCFSoftShadowMap
        this.instance.setClearColor(0x111111, 1)
        this.resize()

        this.instance.init().then(() => {
            this.initialized = true
        })
    }

    public resize() {
        const { width, height, pixelRatio } = this.experience.sizes
        this.instance.setSize(width, height)
        this.instance.setPixelRatio(pixelRatio)
    }

    public update() {
        if (!this.initialized) return
        this.instance.render(this.experience.scene, this.experience.camera.instance)
    }
}
