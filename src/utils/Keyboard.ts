// Tracks which keys are currently held down (by `event.key`, lowercased).
export default class Keyboard {
    private pressed = new Set<string>()

    private onKeyDown = (event: KeyboardEvent) => this.pressed.add(event.key.toLowerCase())
    private onKeyUp = (event: KeyboardEvent) => this.pressed.delete(event.key.toLowerCase())
    // Releasing a key while the tab is unfocused never fires keyup: forget everything.
    private onBlur = () => this.pressed.clear()

    constructor() {
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('blur', this.onBlur)
    }

    public isDown(...keys: string[]) {
        return keys.some((key) => this.pressed.has(key))
    }

    public dispose() {
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('blur', this.onBlur)
    }
}
