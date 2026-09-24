import * as THREE from 'three/webgpu'
import type GUI from 'lil-gui'
import type Experience from '../Experience'
import {
    uniform,
    texture,
    vec4,
    Fn,
    positionLocal,
    storageTexture,
    instanceIndex,
    uvec2,
    vec3,
    min,
    div,
    add,
    normalLocal,
    cross,
    mix,
    mx_noise_float
} from 'three/tsl'

type StorageTextureNode = ReturnType<typeof storageTexture>

/**
 * Tuto: https://threejs-journey.com/lessons/webgpu-tsl/snow
 */
export default class SnowFloor {

    public mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>

    private experience: Experience
    private params = {
        size: 200,
        vertices: 512,
        elevation: 2,
        normalRepeat: 34,
    }
    private uniforms = {
        thickness: uniform(0.3),
        safe: uniform(1),
        // Roughness varies with a noise so some places look frozen (shinier)
        roughnessFrozen: uniform(0.3),
        roughnessSnow: uniform(0.9),
        roughnessNoiseFrequency: uniform(0.3),
    }

    // Depth pass (what digs into the snow, seen from below)
    private depthCamera!: THREE.OrthographicCamera
    private depthRenderTarget!: THREE.RenderTarget
    private depthTexture!: THREE.DepthTexture
    private depthMaterial!: THREE.NodeMaterial

    // Compute texture holding the snow state
    private snowTexture!: THREE.StorageTexture
    private snowTextureNode!: StorageTextureNode

    private debugPlane?: THREE.Mesh<THREE.PlaneGeometry, THREE.NodeMaterial>

    constructor(experience: Experience) {
        this.experience = experience

        this.createDepthPass()
        this.createSnowTexture()
        this.mesh = this.createMesh()
        this.createDepthCamera()
        this.resetSnow()
        this.createDebugPlane()
    }

    /**
     * Render target + material used to render the objects digging into the snow
     */
    private createDepthPass() {
        this.depthTexture = new THREE.DepthTexture()
        this.depthRenderTarget = new THREE.RenderTarget(this.params.vertices, this.params.vertices)
        this.depthRenderTarget.depthTexture = this.depthTexture

        this.depthMaterial = new THREE.NodeMaterial()
        this.depthMaterial.fragmentNode = vec4(0, 0, 0, 1)
    }

    private createSnowTexture() {
        this.snowTexture = new THREE.StorageTexture(this.params.vertices, this.params.vertices)
        this.snowTexture.format = THREE.RedFormat
        this.snowTexture.type = THREE.FloatType

        this.snowTextureNode = storageTexture(this.snowTexture).setAccess(THREE.NodeAccess.READ_WRITE)
    }

    private createNormalTexture() {
        const normalTexture = this.experience.ressources.items['snow_normal']
        normalTexture.wrapS = THREE.RepeatWrapping
        normalTexture.wrapT = THREE.RepeatWrapping
        normalTexture.repeat.setScalar(this.params.normalRepeat)
        return normalTexture
    }

    private createMaterial() {
        const material = new THREE.MeshStandardNodeMaterial({
            normalMap: this.createNormalTexture(),
        })

        const roughness = Fn(() => {
            // mx_noise_float returns roughly [-1, 1], remapped to [0, 1]
            const noise = mx_noise_float(positionLocal.xy.mul(this.uniforms.roughnessNoiseFrequency))
                .mul(0.5)
                .add(0.5)
                .clamp()

            return mix(this.uniforms.roughnessFrozen, this.uniforms.roughnessSnow, noise)
        })()
        material.roughnessNode = roughness

        // Debug: roughness displayed in the red channel
        // material.colorNode = vec3(roughness, 0, 0)

        material.positionNode = Fn(() => {
            const newPosition = positionLocal.toVar()
            newPosition.z.addAssign(this.snowElevation(newPosition.xy))

            //Normals
            const spacing = this.params.size / this.params.vertices
            const pointA = positionLocal.add(vec3(spacing, 0, 0)).toVar()
            const pointB = positionLocal.add(vec3(0, spacing, 0)).toVar()

            pointA.z.addAssign(this.snowElevation(pointA.xy))
            pointB.z.addAssign(this.snowElevation(pointB.xy))

            const toA = pointA.sub(newPosition).normalize()
            const toB = pointB.sub(newPosition).normalize()

            normalLocal.assign(cross(toA, toB).normalize())

            // Offset applied after the normals so the neighbours stay on the same reference
            newPosition.z.subAssign(0.3)

            return newPosition
        })()

        return material
    }

    private snowElevation(position: THREE.Node<'vec2'>) {
        const snowUV = position.div(this.params.size).add(0.5)
        return texture(this.snowTexture, snowUV).r
    }

    private createMesh() {
        const geometry = new THREE.PlaneGeometry(
            this.params.size,
            this.params.size,
            this.params.vertices,
            this.params.vertices
        )

        const mesh = new THREE.Mesh(geometry, this.createMaterial())
        mesh.receiveShadow = true
        mesh.castShadow = true
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = this.params.elevation

        return mesh
    }

    private createDepthCamera() {
        const halfSize = this.params.size / 2
        const near = 1
        const far = near + this.uniforms.safe.value + this.uniforms.thickness.value + 0.5 // 0.5 is arbitrary added to compense the cube tilt.

        this.depthCamera = new THREE.OrthographicCamera(
            -halfSize,
            halfSize,
            halfSize,
            -halfSize,
            near,
            far,
        )

        this.depthCamera.position.y = near + this.uniforms.safe.value - this.params.elevation
        this.depthCamera.rotation.x = Math.PI * 0.5

        this.experience.scene.add(this.depthCamera)
    }

    /**
     * Fill the snow compute texture with its initial value
     */
    private resetSnow() {
        const vertices = this.params.vertices

        const resetCompute = Fn(() => {
            const indexUV = uvec2(
                instanceIndex.mod(vertices),
                instanceIndex.div(vertices)
            )
            this.snowTextureNode.store(indexUV, vec4(1, 0, 0, 0))
        })().compute(vertices * vertices)

        this.experience.renderer.instance.compute(resetCompute)
    }

    private getUpdateSnowCompute() {

        const vertices = this.params.vertices

        return Fn(() => {
            const indexUV = uvec2(
                instanceIndex.mod(vertices),
                instanceIndex.div(vertices)
            )

            const textureUV = indexUV.toVec2().div(vertices)

            const currentSnow = this.snowTextureNode.load(indexUV).r
            const newSnow = currentSnow.toVar()


            const depth = texture(this.depthTexture, textureUV).r
                .remapClamp(
                    div(this.uniforms.safe.value, add(this.uniforms.thickness.value, this.uniforms.safe.value)),
                    1, 0, this.uniforms.thickness.value
                )
            newSnow.assign(min(depth, newSnow))

            this.snowTextureNode.store(indexUV, vec4(newSnow, 0, 0, 0))


        })().compute(vertices * vertices)


    }
    private createDebugPlane() {
        // this.experience.scene.add(new THREE.CameraHelper(this.depthCamera))

        const material = new THREE.NodeMaterial()
        material.fragmentNode = vec4(texture(this.snowTexture).r, 0, 0, 1)

        this.debugPlane = new THREE.Mesh(new THREE.PlaneGeometry(), material)
        this.debugPlane.position.y = 4
        this.debugPlane.scale.setScalar(3)

        this.experience.scene.add(this.debugPlane)
    }

    public debug(gui: GUI) {
        const folder = gui.addFolder('snow')

        folder.add(this.params, 'normalRepeat', 0, 1000, 1).onChange((value: number) => {
            this.mesh.material.normalMap?.repeat.setScalar(value)
        })

        const material = this.mesh.material
        const materialProxy = { color: `#${material.color.getHexString()}`, normalStrength: material.normalScale.x }
        folder.addColor(materialProxy, 'color').onChange((hex: string) => material.color.set(hex))
        folder.add(this.uniforms.roughnessFrozen, 'value', 0, 1, 0.01).name('roughnessFrozen')
        folder.add(this.uniforms.roughnessSnow, 'value', 0, 1, 0.01).name('roughnessSnow')
        folder.add(this.uniforms.roughnessNoiseFrequency, 'value', 0.01, 5, 0.01).name('roughnessNoiseFrequency')
        folder.add(material, 'metalness', 0, 1, 0.01)
        folder.add(materialProxy, 'normalStrength', 0, 3, 0.01).onChange((value: number) => {
            material.normalScale.setScalar(value)
        })

        if (this.debugPlane) folder.add(this.debugPlane, 'visible').name('debugPlane')
        folder.add({ reset: () => this.resetSnow() }, 'reset').name('resetSnow')

        return folder
    }

    update() {
        const renderer = this.experience.renderer.instance
        const rendererState = THREE.RendererUtils.resetRendererState(renderer)

        const scene = this.experience.scene
        const background = scene.background
        const fog = scene.fog

        // Only keep the objects that dig into the snow, on a black background
        scene.background = null
        scene.fog = null
        scene.overrideMaterial = this.depthMaterial
        this.setOwnVisibility(false)

        renderer.setRenderTarget(this.depthRenderTarget)
        renderer.render(scene, this.depthCamera)

        scene.background = background
        scene.fog = fog
        scene.overrideMaterial = null
        this.setOwnVisibility(true)

        THREE.RendererUtils.restoreRendererState(renderer, rendererState)



        this.experience.renderer.instance.compute(this.getUpdateSnowCompute())
    }

    private setOwnVisibility(visible: boolean) {
        this.mesh.visible = visible
        if (this.debugPlane) this.debugPlane.visible = visible
    }
}
