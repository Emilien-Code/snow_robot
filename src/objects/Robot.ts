import * as THREE from 'three/webgpu'
import type GUI from 'lil-gui'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type Experience from '../Experience'
import Keyboard from '../utils/Keyboard'

const UP = new THREE.Vector3(0, 1, 0)

// Flying robot moved with ZQSD (or arrows), relative to the camera.
// Physics: keys give an acceleration, velocity integrates it and is slowed by air drag,
// so the robot keeps drifting for a moment after the keys are released.
export default class Robot {
    // Position + heading (yaw). The body inside only tilts.
    public group = new THREE.Group()
    public velocity = new THREE.Vector3()

    public params = {

        mass: 1, 
        acceleration: 14,
        maxSpeed: 9,
        grip: 1.6, 
        slowDown: 1.6,
        turnSpeed: 4, 

        tilt: 0.025, 
        tiltResponse: 5, 

        hoverHeight: 2.5,
        bobAmplitude: 0.03,
        bobSpeed: 0.1,
        sway: 0.6, 
    }


    public stats = { speed: 0, stopTime: 0 }


    public bounds = new THREE.Vector2(3, 95)


    public controllable = true

    // Tilts with the physics. Holds the glb model, centered on the pivot.
    private body = new THREE.Group()
    private model: THREE.Group
    private keyboard = new Keyboard()
    // private headlight: THREE.PointLight

    // Base values of the headlight (the pulse is applied on top of `intensity` every frame).
    // public lightParams = {
    //     color: '#cfe9ff',
    //     intensity: 14,
    //     pulse: 0.15, // 0 = steady, 0.3 = strong breathing synced with the hover
    // }

    private input = new THREE.Vector3()
    private acceleration = new THREE.Vector3()
    private localAcceleration = new THREE.Vector3()
    private forward = new THREE.Vector3()
    private right = new THREE.Vector3()
    private yaw = 0
    private pitch = 0
    private roll = 0

    constructor(experience: Experience) {
        const gltf = experience.ressources.items['robot'] as GLTF
        this.model = gltf.scene
        // Helper cylinder left in the export (wraps the whole robot, no material)
        this.model.getObjectByName('Cylinder')?.removeFromParent()

        // The glb origin is at its feet: recenter it so it tilts around its middle
        const center = new THREE.Box3().setFromObject(this.model).getCenter(new THREE.Vector3())
        this.model.position.sub(center)
        // The model faces +Z, the robot moves toward -Z
        this.model.rotation.y = Math.PI
        this.model.position.x *= -1
        this.model.position.z *= -1

        this.body.add(this.model)
        this.group.add(this.body)

        // In the group, not the body: it follows position + heading but not the tilt.
        // this.headlight = new THREE.PointLight(this.lightParams.color, this.lightParams.intensity, 0, 2)
        // this.headlight.position.set(0, 0.3, -0.8)
        // this.group.add(this.headlight)

        this.group.position.set(0, this.params.hoverHeight, 0)
    }

    public update(delta: number, elapsed: number, camera: THREE.Camera) {
        // --- Input direction, relative to the camera, flattened on the ground
        camera.getWorldDirection(this.forward)
        this.forward.y = 0
        this.forward.normalize()
        this.right.crossVectors(this.forward, UP).normalize()

        this.input.set(0, 0, 0)
        if (this.controllable && this.keyboard.isDown('z', 'arrowup')) this.input.add(this.forward)
        if (this.controllable && this.keyboard.isDown('s', 'arrowdown')) this.input.sub(this.forward)
        if (this.controllable && this.keyboard.isDown('d', 'arrowright')) this.input.add(this.right)
        if (this.controllable && this.keyboard.isDown('q', 'arrowleft')) this.input.sub(this.right)

        if (this.input.lengthSq() > 0) this.input.normalize()


        const { params } = this
        const thrusting = this.input.lengthSq() > 0
        this.acceleration.copy(this.input).multiplyScalar(params.acceleration / params.mass)
        this.velocity.addScaledVector(this.acceleration, delta)

        const drag = (thrusting ? params.grip : params.slowDown) / params.mass
        this.velocity.multiplyScalar(Math.exp(-drag * delta))
        this.velocity.clampLength(0, params.maxSpeed)

        const position = this.group.position
        position.addScaledVector(this.velocity, delta)


        if (Math.abs(position.x) > this.bounds.x) {
            position.x = Math.sign(position.x) * this.bounds.x
            this.velocity.x *= -0.3
        }
        if (Math.abs(position.z) > this.bounds.y) {
            position.z = Math.sign(position.z) * this.bounds.y
            this.velocity.z *= -0.3
        }


        const bob = Math.sin(elapsed * params.bobSpeed) + Math.sin(elapsed * params.bobSpeed * 1.65) * 0.4
        position.y = params.hoverHeight + bob * params.bobAmplitude


        const speed = Math.hypot(this.velocity.x, this.velocity.z)
        if (speed > 0.3) {

            const targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z)
            const deltaYaw = THREE.MathUtils.euclideanModulo(targetYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI
            this.yaw += deltaYaw * (1 - Math.exp(-params.turnSpeed * delta))
        }
        this.group.rotation.y = this.yaw



        this.localAcceleration.copy(this.acceleration).applyAxisAngle(UP, -this.yaw)
        const targetPitch = this.localAcceleration.z * params.tilt + Math.sin(elapsed * 1.7) * 0.03 * params.sway
        const targetRoll = -this.localAcceleration.x * params.tilt + Math.sin(elapsed * 1.3) * 0.04 * params.sway
        const smoothing = 1 - Math.exp(-params.tiltResponse * delta)
        this.pitch += (targetPitch - this.pitch) * smoothing
        this.roll += (targetRoll - this.roll) * smoothing
        this.body.rotation.set(this.pitch, 0, this.roll)

        // this.headlight.intensity = this.lightParams.intensity * (1 + Math.sin(elapsed * params.bobSpeed) * this.lightParams.pulse)

        this.stats.speed = speed

        this.stats.stopTime = Math.log(10) * params.mass / params.slowDown
    }

    public debug(gui: GUI) {
        const folder = gui.addFolder('robot')
        folder.add(this.model.rotation, 'y', -Math.PI, Math.PI, 0.01).name('modelRotationY')

        const movement = folder.addFolder('movement')
        movement.add(this.params, 'mass', 0.1, 5, 0.01).name('mass (lightness)')
        movement.add(this.params, 'acceleration', 1, 60, 0.1)
        movement.add(this.params, 'maxSpeed', 1, 30, 0.1)
        movement.add(this.params, 'grip', 0, 10, 0.01)
        movement.add(this.params, 'slowDown', 0.05, 10, 0.01)
        movement.add(this.params, 'turnSpeed', 0.5, 20, 0.1)
        movement.add(this.stats, 'speed').decimals(2).listen().disable()
        movement.add(this.stats, 'stopTime').name('stopTime (s)').decimals(2).listen().disable()

        const leaning = folder.addFolder('leaning')
        leaning.add(this.params, 'tilt', 0, 0.1, 0.001)
        leaning.add(this.params, 'tiltResponse', 0.5, 20, 0.1)

        const hover = folder.addFolder('hover')
        hover.add(this.params, 'hoverHeight', 0.5, 5, 0.01)
        hover.add(this.params, 'bobAmplitude', 0, 0.5, 0.001)
        hover.add(this.params, 'bobSpeed', 0, 8, 0.01)
        hover.add(this.params, 'sway', 0, 5, 0.01)

        // const light = folder.addFolder('headlight')
        // light.addColor(this.lightParams, 'color').onChange((hex: string) => this.headlight.color.set(hex))
        // light.add(this.lightParams, 'intensity', 0, 100, 0.1)
        // light.add(this.headlight, 'distance', 0, 30, 0.1)
        // light.add(this.headlight, 'decay', 0, 4, 0.01)
        // light.add(this.headlight.position, 'y', -1, 3, 0.01).name('offsetY')
        // light.add(this.headlight.position, 'z', -3, 1, 0.01).name('offsetZ')
        // light.add(this.lightParams, 'pulse', 0, 0.5, 0.01)

        return folder
    }

    public dispose() {
        this.keyboard.dispose()
        this.model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            child.geometry.dispose()
            const materials = Array.isArray(child.material) ? child.material : [child.material]
            for (const material of materials) material.dispose()
        })
        // this.headlight.dispose()
        this.group.removeFromParent()
    }
}
