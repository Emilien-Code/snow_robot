import * as THREE from 'three/webgpu'
import type Experience from '../Experience'
import World from '../classes/World'
import Robot from '../objects/Robot'
import RockTunnel from '../objects/Rock'

const FOG_COLOR = '#0b0c0f'
const FLOOR_SIZE = 100

export default class CubeWorld extends World {
    private experience: Experience
    private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardNodeMaterial>
    private grid: THREE.GridHelper
    private robot: Robot
    private lights: THREE.Group
    private followTarget = new THREE.Vector3()
    private followMove = new THREE.Vector3()
    // How tightly the camera sticks to the robot (lower = more floaty lag)
    private cameraParams = { followSpeed: 4 }

    constructor(experience: Experience) {
        super()
        this.experience = experience
        const scene = experience.scene

        scene.background = new THREE.Color(FOG_COLOR)
        scene.fog = new THREE.Fog(FOG_COLOR, 10, 55)


        /**
         * FLOOR
         */
        this.floor = new THREE.Mesh(
            new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
            new THREE.MeshStandardNodeMaterial({ color: '#2a2d33', roughness: 0.9 }),
        )

        this.floor.rotation.x = -Math.PI / 2
        // scene.add(this.floor)


        const rock = new RockTunnel()
        scene.add(rock.mesh)


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
        this.robot = new Robot()
        this.robot.bounds.set(FLOOR_SIZE / 2 - 2, FLOOR_SIZE / 2 - 2)
        scene.add(this.robot.group)









        /**
         * Lights (random)
         */

        this.lights = new THREE.Group()
        const ambient = new THREE.AmbientLight('#f3ede8', 0.25)
        const directional = new THREE.DirectionalLight('#ffe9d0', 1.2)
        directional.position.set(3, 4, 2)
        this.lights.add(ambient, directional)
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
        const tunnelFolder = rock.debug(gui)

        robotFolder.add(this.cameraParams, 'followSpeed', 0.5, 20, 0.1).name('cameraFollow')
        
    }

    update() {
        const { time, camera } = this.experience
        const delta = Math.min(time.delta * 0.001, 0.05)
        const elapsed = time.elapsed * 0.001

        this.robot.controllable = !camera.params.free
        this.robot.update(delta, elapsed, camera.instance)

        // Free (debug) camera: leave it alone
        if (camera.params.free) return

        // The camera follows with a bit of lag (and ignores the bobbing): feels like floating.
        const target = camera.controls.target
        this.followTarget.set(this.robot.group.position.x, this.robot.params.hoverHeight, this.robot.group.position.z)
        this.followMove.copy(target).lerp(this.followTarget, 1 - Math.exp(-this.cameraParams.followSpeed * delta)).sub(target)
        target.add(this.followMove)
        camera.instance.position.add(this.followMove)
    }

    dispose() {
        const scene = this.experience.scene
        this.disposeObject(this.floor)
        this.grid.dispose()
        this.grid.removeFromParent()
        this.robot.dispose()
        this.lights.removeFromParent()
        // this.disposeObject(this.tunnel.mesh)
        scene.fog = null
        scene.background = null
    }
}
