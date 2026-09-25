import * as THREE from 'three/webgpu'
import type Experience from '../Experience'
import World from '../classes/World'
import Robot from '../objects/Robot'
import Rock from '../objects/Rock'
import SnowFloor from '../objects/SnowFloor'
import Rain from '../objects/Rain'
const FOG_COLOR = '#ffffff'
const FLOOR_SIZE = 100

export default class CubeWorld extends World {
    private experience: Experience
    private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>
    private rock: Rock
    private snowFloor: SnowFloor
    private rain: Rain

    private grid: THREE.GridHelper
    private robot: Robot
    private lights: THREE.Group
    private directional: THREE.DirectionalLight
    private lightOffset = new THREE.Vector3()
    private followTarget = new THREE.Vector3()
    private followMove = new THREE.Vector3()
    // How tightly the camera sticks to the robot (lower = more floaty lag)
    private cameraParams = { followSpeed: 4 }

    constructor(experience: Experience) {
        super()
        this.experience = experience
        const scene = experience.scene

        const background = new THREE.Color(FOG_COLOR)
        const fog = new THREE.Fog(FOG_COLOR, 10, 55)
        scene.background = background
        scene.fog = fog


        /**
         * FLOOR
         */
        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
            new THREE.MeshStandardNodeMaterial({ color: '#2a2d33', roughness: 0.9 }),
        )

        this.floor.rotation.x = -Math.PI / 2
        // scene.add(this.floor)


        this.rock = new Rock()
        scene.add(this.rock.mesh)

        this.snowFloor = new SnowFloor(this.experience)
        scene.add(this.snowFloor.mesh)











        /**
         * GRID
         */
        this.grid = new THREE.GridHelper(FLOOR_SIZE, FLOOR_SIZE, '#6b7585', '#40464f')
        // Slightly above the floor to avoid z-fighting (flickering between two surfaces at the same height)
        this.grid.position.y = 0.001
        scene.add(this.grid)



        /**
         * ROBOT
         */
        this.robot = new Robot(this.experience)
        this.robot.bounds.set(FLOOR_SIZE / 2 - 2, FLOOR_SIZE / 2 - 2)
        scene.add(this.robot.group)


        /**
         * RAIN
         */
        this.rain = new Rain(this.experience, (xz) => this.snowFloor.heightAt(xz))
        this.rain.addCollider(this.robot.group)
        scene.add(this.rain.mesh)









        /**
         * Lights (random)
         */

        this.lights = new THREE.Group()
        const ambient = new THREE.AmbientLight('#f3ede8', 0.25)
        const directional = new THREE.DirectionalLight('#ffe9d0', 1.2)
        this.lightOffset.set(3, 4, 2)
        directional.position.copy(this.lightOffset)


        directional.castShadow = true
        directional.shadow.mapSize.setScalar(1024)
        directional.shadow.camera.left = -6
        directional.shadow.camera.right = 6
        directional.shadow.camera.top = 6
        directional.shadow.camera.bottom = -6
        directional.shadow.camera.near = 0.1
        directional.shadow.camera.far = 20
        directional.shadow.bias = -0.0005
        directional.shadow.normalBias = 0.02
        this.directional = directional

        this.lights.add(ambient, directional, directional.target)
        scene.add(this.lights)




        /**
         * Camera
         */
        const { instance: camera, controls } = experience.camera
        camera.position.set(0, 3.2, 7.5)
        controls.target.copy(this.robot.group.position)
        controls.maxPolarAngle = Math.PI * 0.49
        controls.maxDistance = 12
        this.followTarget.copy(controls.target)



        /**
         * Debug
         */
        const gui = experience.helpers.GUI
        const robotFolder = this.robot.debug(gui)
        const tunnelFolder = this.rock.debug(gui)
        this.snowFloor.debug(gui)
        this.rain.debug(gui)

        robotFolder.add(this.cameraParams, 'followSpeed', 0.5, 20, 0.1).name('cameraFollow')

        const fogFolder = gui.addFolder('fog')
        // The background matches the fog so distant objects fade into it
        const fogProxy = { color: `#${fog.color.getHexString()}` }
        fogFolder.addColor(fogProxy, 'color').onChange((hex: string) => {
            fog.color.set(hex)
            background.set(hex)
        })
        fogFolder.add(fog, 'near', 0, 100, 0.1)
        fogFolder.add(fog, 'far', 0, 200, 0.1)

        const lightsFolder = gui.addFolder('lights')
        const lightsProxy = {
            ambientColor: `#${ambient.color.getHexString()}`,
            directionalColor: `#${directional.color.getHexString()}`,
        }
        lightsFolder.addColor(lightsProxy, 'ambientColor').onChange((hex: string) => ambient.color.set(hex))
        lightsFolder.add(ambient, 'intensity', 0, 3, 0.01).name('ambientIntensity')
        lightsFolder.addColor(lightsProxy, 'directionalColor').onChange((hex: string) => directional.color.set(hex))
        lightsFolder.add(directional, 'intensity', 0, 10, 0.01).name('directionalIntensity')
        lightsFolder.add(this.lightOffset, 'x', -20, 20, 0.1).name('directionalX')
        lightsFolder.add(this.lightOffset, 'y', 0, 20, 0.1).name('directionalY')
        lightsFolder.add(this.lightOffset, 'z', -20, 20, 0.1).name('directionalZ')

    }

    update() {
        const { time, camera } = this.experience
        const delta = Math.min(time.delta * 0.001, 0.05)
        const elapsed = time.elapsed * 0.001

        this.robot.controllable = !camera.params.free
        this.robot.update(delta, elapsed, camera.instance)

        const robotPosition = this.robot.group.position
        this.directional.target.position.copy(robotPosition)
        this.directional.position.copy(robotPosition).add(this.lightOffset)

        // Free (debug) camera: leave it alone
        if (camera.params.free) return

        // The camera follows with a bit of lag (and ignores the bobbing): feels like floating.
        const target = camera.controls.target
        this.followTarget.set(this.robot.group.position.x, this.robot.params.hoverHeight, this.robot.group.position.z)
        this.followMove.copy(target).lerp(this.followTarget, 1 - Math.exp(-this.cameraParams.followSpeed * delta)).sub(target)
        target.add(this.followMove)
        camera.instance.position.add(this.followMove)



        this.snowFloor.update()
        this.rain.update(delta, this.robot.group.position)
    }

    dispose() {
        const scene = this.experience.scene
        this.disposeObject(this.floor)
        this.grid.dispose()
        this.grid.removeFromParent()
        this.robot.dispose()
        this.rain.dispose()
        this.lights.removeFromParent()
        // this.disposeObject(this.tunnel.mesh)
        scene.fog = null
        scene.background = null
    }
}
