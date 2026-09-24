import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type Experience from '../Experience'
import type Sizes from './Sizes'

export default class Camera {
    public instance: THREE.PerspectiveCamera
    public controls: OrbitControls

    private sizes: Sizes

    constructor(experience: Experience) {
        this.sizes = experience.sizes

        this.instance = new THREE.PerspectiveCamera(35, this.sizes.width / this.sizes.height, 0.1, 100)
        this.instance.position.set(4, 3, 6)
        experience.scene.add(this.instance)

        this.controls = new OrbitControls(this.instance, experience.canvas)
        this.controls.enableDamping = true
    }

    public resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height
        this.instance.updateProjectionMatrix()
    }

    public update() {
        this.controls.update()
    }
}
