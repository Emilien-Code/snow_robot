
import * as THREE from "three/webgpu"
import type Experience from "../Experience"
import {
    uniform,
    uv,
    texture,
} from "three/tsl"

export default class Smoke {

    private experience: Experience
    private uniforms = {
        speed: uniform(0.5),
        opacity: uniform(0.4)
    }

    public sprite: THREE.Sprite

    constructor(exp: Experience) {

        this.experience = exp


        const t = this.experience.ressources.items["smoke"]

        const smokeMaterial = new THREE.SpriteNodeMaterial();
        smokeMaterial.colorNode = t.texture




        const smokeTexture = texture(t.texture, uv())
        // const smokeOpacity = smokeTexture.a

        smokeMaterial.depthWrite = false;
        smokeMaterial.depthTest = true;
        smokeMaterial.transparent = true;


        this.sprite = new THREE.Sprite(smokeMaterial)
        this.sprite.scale.setScalar(6)





        this.sprite.count = 60
        this.experience.scene.add(this.sprite)


    }

    update() {

    }
}