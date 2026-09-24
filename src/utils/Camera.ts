import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type Experience from '../Experience'
import type Sizes from './Sizes'
import type Time from './Time'
import Keyboard from './Keyboard'

const UP = new THREE.Vector3(0, 1, 0)

export default class Camera {
    public instance: THREE.PerspectiveCamera
    public controls: OrbitControls

    // Debug free camera: detached from the world, flown with ZQSD (+ space / shift for up / down)
    public params = { free: false, flySpeed: 8 }

    private sizes: Sizes
    private time: Time
    private keyboard = new Keyboard()
    private forward = new THREE.Vector3()
    private right = new THREE.Vector3()
    private move = new THREE.Vector3()
    // What the camera looked like before going free, restored when coming back
    private saved = {
        position: new THREE.Vector3(),
        target: new THREE.Vector3(),
        maxDistance: Infinity,
        maxPolarAngle: Math.PI,
    }

    constructor(experience: Experience) {
        this.sizes = experience.sizes
        this.time = experience.time

        this.instance = new THREE.PerspectiveCamera(35, this.sizes.width / this.sizes.height, 0.1, 100)
        this.instance.position.set(4, 3, 6)
        experience.scene.add(this.instance)

        this.controls = new OrbitControls(this.instance, experience.canvas)
        this.controls.enableDamping = true

        const folder = experience.helpers.GUI.addFolder('camera')
        folder.add(this.params, 'free').name('free camera').onChange((free: boolean) => this.setFree(free))
        folder.add(this.params, 'flySpeed', 1, 50, 0.1)
    }

    public setFree(free: boolean) {
        this.params.free = free
        const { controls, saved } = this

        if (free) {
            saved.position.copy(this.instance.position)
            saved.target.copy(controls.target)
            saved.maxDistance = controls.maxDistance
            saved.maxPolarAngle = controls.maxPolarAngle
            controls.maxDistance = Infinity
            controls.maxPolarAngle = Math.PI
        } else {
            this.instance.position.copy(saved.position)
            controls.target.copy(saved.target)
            controls.maxDistance = saved.maxDistance
            controls.maxPolarAngle = saved.maxPolarAngle
        }
    }

    public resize() {
        this.instance.aspect = this.sizes.width / this.sizes.height
        this.instance.updateProjectionMatrix()
    }

    public update() {
        if (this.params.free) this.fly()
        this.controls.update()
    }

    // Moves the camera and its orbit target together, relative to where the camera looks
    private fly() {
        const delta = Math.min(this.time.delta * 0.001, 0.05)
        this.instance.getWorldDirection(this.forward)
        this.right.crossVectors(this.forward, UP).normalize()

        const { keyboard, move } = this
        move.set(0, 0, 0)
        if (keyboard.isDown('z', 'arrowup')) move.add(this.forward)
        if (keyboard.isDown('s', 'arrowdown')) move.sub(this.forward)
        if (keyboard.isDown('d', 'arrowright')) move.add(this.right)
        if (keyboard.isDown('q', 'arrowleft')) move.sub(this.right)
        if (keyboard.isDown(' ')) move.add(UP)
        if (keyboard.isDown('shift')) move.sub(UP)
        if (move.lengthSq() === 0) return

        move.normalize().multiplyScalar(this.params.flySpeed * delta)
        this.instance.position.add(move)
        this.controls.target.add(move)
    }
}
