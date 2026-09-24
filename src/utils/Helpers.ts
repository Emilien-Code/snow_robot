import GUI from 'lil-gui'

// Debug panel: always visible in dev (`pnpm dev`), and in production builds only when
// the URL hash contains `debug` (e.g. /#debug). Press H to show / hide it.
export default class Helpers {
    public GUI: GUI
    public active: boolean

    constructor() {
        this.active = import.meta.env.DEV || window.location.hash.includes('debug')
        this.GUI = new GUI()
        
        Object.assign(this.GUI.domElement.style, { left: '15px', right: 'auto', zIndex: '999' })
        this.GUI.show(this.active)

        window.addEventListener('hashchange', () => {
            if (window.location.hash.includes('debug')) this.GUI.show()
        })
        window.addEventListener('keydown', (event) => {
            if (event.key.toLowerCase() === 'h') this.GUI.show(this.GUI._hidden)
        })
    }
}
