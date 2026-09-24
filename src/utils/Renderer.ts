import * as THREE from 'three/webgpu'
import { Inspector } from 'three/addons/inspector/Inspector.js'
import type Experience from '../Experience'

export default class Renderer {
    public instance: THREE.WebGPURenderer
    // WebGPURenderer needs an async init() before the first render.
    public initialized = false

    private experience: Experience

    constructor(experience: Experience) {
        this.experience = experience

        this.instance = new THREE.WebGPURenderer({
            canvas: experience.canvas,
            antialias: true,
        })
        this.instance.toneMapping = THREE.ACESFilmicToneMapping
        this.instance.shadowMap.enabled = true
        this.instance.shadowMap.type = THREE.PCFSoftShadowMap
        this.instance.setClearColor(0x111111, 1)
        this.resize()

        if (experience.helpers.active) {
            const inspector = new Inspector()
            this.instance.inspector = inspector
            window.addEventListener('keydown', (event) => {
                if (event.key.toLowerCase() === 'h') inspector.setVisible(!inspector.getVisible())
            })
        }

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
