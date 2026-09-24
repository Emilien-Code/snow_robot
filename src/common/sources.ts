import type { Source } from '../utils/Ressources'

// Assets to preload before the world is created. Paths are relative to /public.
// e.g. { name: 'model', type: 'GLTFModel', path: ['model.glb'] }
//      { name: 'color', type: 'texture', path: ['color.jpg'] }
const sources: Source[] = [
    { name: 'snow_normal', type: 'texture', path: ['snow_field_aerial_nor_gl_2k.png'] },
    { name: 'robot', type: 'GLTFModel', path: ['robot.glb'] },
]

export default sources
