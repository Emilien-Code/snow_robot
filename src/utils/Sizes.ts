import EventEmitter from './EventEmitter'

export default class Sizes extends EventEmitter {
    public width = window.innerWidth
    public height = window.innerHeight
    public pixelRatio = Math.min(window.devicePixelRatio, 2)

    constructor() {
        super()

        window.addEventListener('resize', () => {
            this.width = window.innerWidth
            this.height = window.innerHeight
            this.pixelRatio = Math.min(window.devicePixelRatio, 2)
            this.trigger('resize')
        })
    }
}
