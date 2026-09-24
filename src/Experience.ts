import * as THREE from 'three/webgpu'
import Sizes from './utils/Sizes'
import Time from './utils/Time'
import Helpers from './utils/Helpers'
import Camera from './utils/Camera'
import Renderer from './utils/Renderer'
import Ressources from './utils/Ressources'
import sources from './common/sources'
import type World from './classes/World'
import CubeWorld from './worlds/CubeWorld'

export default class Experience {
    public canvas: HTMLCanvasElement
    public scene = new THREE.Scene()
    public sizes = new Sizes()
    public time = new Time()
    public helpers = new Helpers()
    public camera: Camera
    public renderer: Renderer
    public ressources: Ressources
    public world: World | null = null

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas

        this.camera = new Camera(this)
        this.renderer = new Renderer(this)
        this.ressources = new Ressources(sources)

        this.sizes.on('resize', () => this.resize())
        this.time.on('tick', () => this.update())
        this.ressources.on('ready', () => {
            this.world = new CubeWorld(this)
        })
        this.ressources.startLoading()
    }

    private resize() {
        this.camera.resize()
        this.renderer.resize()
        this.world?.resize()
    }

    private update() {
        this.camera.update()
        this.world?.update()
        this.renderer.update()
    }
}
