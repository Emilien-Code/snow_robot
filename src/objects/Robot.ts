import * as THREE from 'three/webgpu'
import type GUI from 'lil-gui'
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
        // Movement
        mass: 1, // lightness: heavier = slower to speed up AND slower to stop
        acceleration: 14, // thrust while a key is held
        maxSpeed: 9,
        grip: 1.6, // air drag while a key is held: higher = tighter turns, less sliding
        slowDown: 1.6, // air drag once keys are released: higher = stops sooner
        turnSpeed: 4, // how fast it faces its direction

        // Leaning
        tilt: 0.025, // how much it leans into the acceleration
        tiltResponse: 5, // how fast it reaches that lean

        // Hovering
        hoverHeight: 1.6,
        bobAmplitude: 0.12,
        bobSpeed: 2,
        sway: 1, // idle wobble while floating
    }

    // Read-only values shown in the debug panel.
    public stats = { speed: 0, stopTime: 0 }

    // Limits of the flyable area (x: tunnel half width, z: tunnel half length).
    public bounds = new THREE.Vector2(3, 95)

    private body: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardNodeMaterial>
    private keyboard = new Keyboard()

    private input = new THREE.Vector3()
    private acceleration = new THREE.Vector3()
    private localAcceleration = new THREE.Vector3()
    private forward = new THREE.Vector3()
    private right = new THREE.Vector3()
    private yaw = 0
    private pitch = 0
    private roll = 0

    constructor() {
        this.body = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardNodeMaterial({ color: '#4f8cff', roughness: 0.4 }),
        )
        this.group.add(this.body)

        this.group.position.set(0, this.params.hoverHeight, 0)
    }

    public update(delta: number, elapsed: number, camera: THREE.Camera) {
        // --- Input direction, relative to the camera, flattened on the ground
        camera.getWorldDirection(this.forward)
        this.forward.y = 0
        this.forward.normalize()
        this.right.crossVectors(this.forward, UP).normalize()

        this.input.set(0, 0, 0)
        if (this.keyboard.isDown('z', 'arrowup')) this.input.add(this.forward)
        if (this.keyboard.isDown('s', 'arrowdown')) this.input.sub(this.forward)
        if (this.keyboard.isDown('d', 'arrowright')) this.input.add(this.right)
        if (this.keyboard.isDown('q', 'arrowleft')) this.input.sub(this.right)
        // Diagonals are not faster
        if (this.input.lengthSq() > 0) this.input.normalize()

        // --- Physics (forces divided by mass: a lighter robot reacts to everything faster)
        const { params } = this
        const thrusting = this.input.lengthSq() > 0
        this.acceleration.copy(this.input).multiplyScalar(params.acceleration / params.mass)
        this.velocity.addScaledVector(this.acceleration, delta)
        // Exponential drag: frame-rate independent, gives the slow glide to a stop
        const drag = (thrusting ? params.grip : params.slowDown) / params.mass
        this.velocity.multiplyScalar(Math.exp(-drag * delta))
        this.velocity.clampLength(0, params.maxSpeed)

        const position = this.group.position
        position.addScaledVector(this.velocity, delta)

        // Soft bounce on the tunnel limits
        if (Math.abs(position.x) > this.bounds.x) {
            position.x = Math.sign(position.x) * this.bounds.x
            this.velocity.x *= -0.3
        }
        if (Math.abs(position.z) > this.bounds.y) {
            position.z = Math.sign(position.z) * this.bounds.y
            this.velocity.z *= -0.3
        }

        // Hovering: slow, irregular bobbing
        const bob = Math.sin(elapsed * params.bobSpeed) + Math.sin(elapsed * params.bobSpeed * 1.65) * 0.4
        position.y = params.hoverHeight + bob * params.bobAmplitude

        // --- Orientation
        const speed = Math.hypot(this.velocity.x, this.velocity.z)
        if (speed > 0.3) {
            // Turn toward where it is going (forward is -Z), along the shortest way
            const targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z)
            const deltaYaw = THREE.MathUtils.euclideanModulo(targetYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI
            this.yaw += deltaYaw * (1 - Math.exp(-params.turnSpeed * delta))
        }
        this.group.rotation.y = this.yaw

        // Lean into the acceleration, expressed in the robot's own frame:
        // nose down when speeding up, banking when turning.
        this.localAcceleration.copy(this.acceleration).applyAxisAngle(UP, -this.yaw)
        const targetPitch = this.localAcceleration.z * params.tilt + Math.sin(elapsed * 1.7) * 0.03 * params.sway
        const targetRoll = -this.localAcceleration.x * params.tilt + Math.sin(elapsed * 1.3) * 0.04 * params.sway
        const smoothing = 1 - Math.exp(-params.tiltResponse * delta)
        this.pitch += (targetPitch - this.pitch) * smoothing
        this.roll += (targetRoll - this.roll) * smoothing
        this.body.rotation.set(this.pitch, 0, this.roll)

        this.stats.speed = speed
        // Time to lose 90% of its speed after releasing the keys
        this.stats.stopTime = Math.log(10) * params.mass / params.slowDown
    }

    public debug(gui: GUI) {
        const folder = gui.addFolder('robot')
        const colorProxy = { color: `#${this.body.material.color.getHexString()}` }
        folder.addColor(colorProxy, 'color').onChange((hex: string) => this.body.material.color.set(hex))

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

        return folder
    }

    public dispose() {
        this.keyboard.dispose()
        this.body.geometry.dispose()
        this.body.material.dispose()
        this.group.removeFromParent()
    }
}
