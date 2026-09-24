import * as THREE from 'three/webgpu'
import type GUI from 'lil-gui'
import type Experience from '../Experience'
import {
    Fn,
    If,
    uniform,
    instancedArray,
    instanceIndex,
    hash,
    texture,
    uv,
    vec3,
    vec4,
    mix,
    floor,
    positionWorld,
    positionGeometry,
    cameraPosition,
    cross,
} from 'three/tsl'

// Objects on this layer are seen by the collision camera (the rain stops on them)
export const RAIN_COLLISION_LAYER = 1
// The rain lives on its own layer so the other passes (snow depth, collision) never see it
const RAIN_LAYER = 2

/**
 * GPU rain following a center (the robot).
 *
 * Collision: the colliders are rendered from above into a render target storing their
 * world position (alpha = 1 where something was hit). Each drop reads the height under it:
 * below it, the drop respawns at the top. Where nothing was hit, the drop falls to the ground.
 */
export default class Rain {

    public mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>

    private experience: Experience
    private params = {
        count: 1000,
        // Size of the box of rain around the center
        width: 10,
        height: 25,
        dropWidth: 0.1,
        collisionResolution: 512,
    }
    private uniforms = {
        center: uniform(new THREE.Vector3()),
        delta: uniform(0),
        seed: uniform(0),
        speed: uniform(10),
        wind: uniform(new THREE.Vector2(2.87, 5.33)),
        groundHeight: uniform(2.7),
        color: uniform(new THREE.Color('#ffffff')),
        opacity: uniform(0.51),
        length: uniform(0.25),
        lengthRandomness: uniform(0),
        respawnMin: uniform(10),
        respawnMax: uniform(20),
    }

    private positions = instancedArray(this.params.count, 'vec3')
    private velocities = instancedArray(this.params.count, 'vec3')
    private initCompute!: THREE.ComputeNode
    private updateCompute!: THREE.ComputeNode

    private collisionCamera!: THREE.OrthographicCamera
    private collisionRenderTarget!: THREE.RenderTarget
    private collisionMaterial!: THREE.NodeMaterial

    private debugPlane?: THREE.Mesh<THREE.PlaneGeometry, THREE.NodeMaterial>


    private groundAt: (xz: THREE.Node<'vec2'>) => THREE.Node<'float'>

    constructor(experience: Experience, groundAt?: (xz: THREE.Node<'vec2'>) => THREE.Node<'float'>) {
        this.experience = experience
        this.groundAt = groundAt ?? (() => this.uniforms.groundHeight)

        this.createCollisionPass()
        this.createComputes()
        this.mesh = this.createMesh()
        this.createDebugPlane()

        experience.camera.instance.layers.enable(RAIN_LAYER)

        this.reset()
    }


    public addCollider(object: THREE.Object3D) {
        object.traverse((child) => child.layers.enable(RAIN_COLLISION_LAYER))
    }

    /**
     * Render target 
     */
    private createCollisionPass() {
        const { width, height, collisionResolution } = this.params
        const half = width / 2


        this.collisionCamera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, height * 2)

        this.collisionCamera.rotation.x = -Math.PI / 2
        this.collisionCamera.layers.set(RAIN_COLLISION_LAYER)

        this.collisionRenderTarget = new THREE.RenderTarget(collisionResolution, collisionResolution, {
            type: THREE.HalfFloatType,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter,
            generateMipmaps: false,
        })

        this.collisionMaterial = new THREE.NodeMaterial()
        this.collisionMaterial.fragmentNode = vec4(positionWorld, 1)
    }

    private createComputes() {
        const { count, width, height } = this.params
        const u = this.uniforms

        const randomPosition = (seed: THREE.Node<'float'>) => vec3(
            hash(seed).sub(0.5).mul(width),
            hash(seed.add(count)).sub(0.5).mul(height),
            hash(seed.add(count * 2)).sub(0.5).mul(width),
        ).add(u.center)

        this.initCompute = Fn(() => {
            this.positions.element(instanceIndex).assign(randomPosition(instanceIndex.toFloat()))
            this.velocities.element(instanceIndex).assign(vec3(0, -1, 0))
        })().compute(count)

        this.updateCompute = Fn(() => {
            const position = this.positions.element(instanceIndex)
            const velocity = this.velocities.element(instanceIndex)


            position.addAssign(velocity.mul(u.speed).add(vec3(u.wind.x, 0, u.wind.y)).mul(u.delta))

            const local = position.xz.sub(u.center.xz).div(width).add(0.5)
            const wrapped = local.sub(floor(local)).sub(0.5).mul(width).add(u.center.xz).toVar()
            position.x.assign(wrapped.x)
            position.z.assign(wrapped.y)

            const collisionUV = position.xz.sub(u.center.xz).div(width).add(0.5)
            const collision = texture(this.collisionRenderTarget.texture, collisionUV)
            const impactHeight = mix(this.groundAt(position.xz), collision.y, collision.a)

            If(position.y.lessThan(impactHeight), () => {
                const seed = instanceIndex.toFloat().add(u.seed)
                position.y.addAssign(hash(seed).mul(u.respawnMax.sub(u.respawnMin)).add(u.respawnMin))
            })

            If(position.y.lessThan(u.center.y.sub(height / 2)), () => {
                position.y.addAssign(height)
            })
        })().compute(count)
    }

    private createMesh() {
        const { dropWidth, count } = this.params
        const u = this.uniforms

        const geometry = new THREE.PlaneGeometry(dropWidth, 1)
        // The drop position is the front tip of the streak, so it's the tip that touches the ground
        geometry.translate(0, 0.5, 0)

        const material = new THREE.MeshStandardNodeMaterial({
            transparent: true,
            depthWrite: false,
        })

        const center = this.positions.element(instanceIndex)


        const motion = this.velocities.element(instanceIndex).mul(u.speed).add(vec3(u.wind.x, 0, u.wind.y))
        const up = motion.negate().normalize()

        const side = cross(up, cameraPosition.sub(center)).normalize()


        const length = u.length.mul(hash(instanceIndex.toFloat().add(count * 3)).mul(u.lengthRandomness).oneMinus())


        material.positionNode = center
            .add(side.mul(positionGeometry.x))
            .add(up.mul(positionGeometry.y.mul(length)))


        const streak = uv().distance(0.5).oneMinus().pow(5)
        material.colorNode = u.color
        material.opacityNode = streak.mul(u.opacity)

        const mesh = new THREE.Mesh(geometry, material)
        mesh.count = count

        mesh.frustumCulled = false
        mesh.layers.set(RAIN_LAYER)

        return mesh
    }

    private createDebugPlane() {

        const material = new THREE.NodeMaterial()
        const collision = texture(this.collisionRenderTarget.texture)
        material.fragmentNode = vec4(collision.y.remap(this.uniforms.groundHeight, this.uniforms.groundHeight.add(3)).saturate().mul(collision.a), 0, 0, 1)

        this.debugPlane = new THREE.Mesh(new THREE.PlaneGeometry(), material)
        this.debugPlane.position.set(4, 4, 0)
        this.debugPlane.scale.setScalar(3)
        this.debugPlane.visible = false
        this.debugPlane.layers.set(RAIN_LAYER)

        this.experience.scene.add(this.debugPlane)
    }

    public reset() {
        this.experience.renderer.instance.compute(this.initCompute)
    }

    public debug(gui: GUI) {
        const folder = gui.addFolder('rain')
        const u = this.uniforms

        folder.add(this.mesh, 'visible')
        folder.add(u.speed, 'value', 0, 50, 0.1).name('speed')
        folder.add(u.wind.value, 'x', -10, 10, 0.01).name('windX')
        folder.add(u.wind.value, 'y', -10, 10, 0.01).name('windZ')
        folder.add(u.groundHeight, 'value', -2, 6, 0.01).name('groundHeight')
        folder.add(u.opacity, 'value', 0, 1, 0.01).name('opacity')
        folder.add(u.length, 'value', 0, 6, 0.01).name('length')
        folder.add(u.lengthRandomness, 'value', 0, 1, 0.01).name('lengthRandomness')
        folder.add(u.respawnMin, 'value', 0, 30, 0.1).name('respawnMin')
        folder.add(u.respawnMax, 'value', 0, 30, 0.1).name('respawnMax')
        const colorProxy = { color: `#${u.color.value.getHexString()}` }
        folder.addColor(colorProxy, 'color').onChange((hex: string) => u.color.value.set(hex))
        folder.add(this.mesh, 'count', 0, this.params.count, 1).name('count')
        if (this.debugPlane) folder.add(this.debugPlane, 'visible').name('collisionDebug')
        folder.add({ reset: () => this.reset() }, 'reset')

        return folder
    }


    public update(delta: number, center: THREE.Vector3) {
        if (!this.mesh.visible) return

        const u = this.uniforms
        u.center.value.copy(center)
        u.delta.value = delta
        u.seed.value = Math.random() * 1000

        this.renderCollision()
        this.experience.renderer.instance.compute(this.updateCompute)
    }

    private renderCollision() {
        const renderer = this.experience.renderer.instance
        const scene = this.experience.scene
        const { height } = this.params

        const camera = this.collisionCamera
        camera.position.copy(this.uniforms.center.value)
        camera.position.y += height
        camera.near = height / 2 - 0.1
        camera.far = height * 1.5 + 0.1
        camera.updateProjectionMatrix()
        camera.updateMatrixWorld()

        const rendererState = THREE.RendererUtils.resetRendererState(renderer)
        const background = scene.background
        const fog = scene.fog


        renderer.setClearColor(0x000000, 0)
        scene.background = null
        scene.fog = null
        scene.overrideMaterial = this.collisionMaterial

        renderer.setRenderTarget(this.collisionRenderTarget)
        renderer.render(scene, camera)

        scene.background = background
        scene.fog = fog
        scene.overrideMaterial = null

        THREE.RendererUtils.restoreRendererState(renderer, rendererState)
    }

    public dispose() {
        this.mesh.geometry.dispose()
        this.mesh.material.dispose()
        this.mesh.removeFromParent()
        this.collisionRenderTarget.dispose()
        this.collisionMaterial.dispose()
        if (this.debugPlane) {
            this.debugPlane.geometry.dispose()
            this.debugPlane.material.dispose()
            this.debugPlane.removeFromParent()
        }
        this.experience.camera.instance.layers.disable(RAIN_LAYER)
    }
}
