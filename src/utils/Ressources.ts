import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import EventEmitter from './EventEmitter'

export interface Source {
    name: string
    type: 'texture' | 'GLTFModel'
    path: string[]
}

export default class Ressources extends EventEmitter {
    public sources: Source[]
    public items: { [key: string]: any } = {}
    public toLoad: number
    public loaded = 0

    private textureLoader = new THREE.TextureLoader()
    private gltfLoader = new GLTFLoader()

    constructor(sources: Source[]) {
        super()
        this.sources = sources
        this.toLoad = sources.length
    }

    startLoading() {
        // Nothing to load: still fire 'ready' (async, so listeners can attach first).
        if (this.toLoad === 0) {
            queueMicrotask(() => this.trigger('ready'))
            return
        }

        for (const source of this.sources) {
            if (source.type === 'GLTFModel') {
                this.gltfLoader.load(source.path[0], (file) => this.sourceLoaded(source, file))
            } else if (source.type === 'texture') {
                this.textureLoader.load(source.path[0], (file) => this.sourceLoaded(source, file))
            }
        }
    }

    private sourceLoaded(source: Source, file: unknown) {
        this.items[source.name] = file
        this.loaded++
        if (this.loaded === this.toLoad) this.trigger('ready')
    }
}
