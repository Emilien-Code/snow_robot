import * as THREE from 'three/webgpu'

// Base class for a world (a self-contained set of objects in the scene).
export default class World {
    update() { }
    resize() { }
    dispose() { }

    // Removes an object from its parent and frees its GPU resources.
    protected disposeObject(object: THREE.Object3D) {
        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return
            child.geometry.dispose()
            const materials = Array.isArray(child.material) ? child.material : [child.material]
            materials.forEach((material) => material.dispose())
        })
        object.removeFromParent()
    }
}
