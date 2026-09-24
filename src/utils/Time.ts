import EventEmitter from './EventEmitter'

export default class Time extends EventEmitter {
    public start = Date.now()
    public current = this.start
    // Milliseconds since start / since the previous frame.
    public elapsed = 0
    public delta = 16

    constructor() {
        super()
        requestAnimationFrame(() => this.tick())
    }

    private tick() {
        const now = Date.now()
        this.delta = now - this.current
        this.current = now
        this.elapsed = now - this.start
        this.trigger('tick')
        requestAnimationFrame(() => this.tick())
    }
}
