interface Callback {
    (...args: any[]): void;
}

interface Name {
    original: string;
    value: string;
    namespace: string;
}

export default class EventEmitter {
    private callbacks: { [namespace: string]: { [event: string]: Callback[] } } = {};

    constructor() {
        this.callbacks.base = {};
    }

    public on(_names: string, callback: Callback): this {
        // Errors
        if (typeof _names === 'undefined' || _names === '') {
            console.warn('wrong names');
            return this;
        }

        if (typeof callback === 'undefined') {
            console.warn('wrong callback');
            return this;
        }

        // Resolve names
        const names = this.resolveNames(_names);

        // Each name
        names.forEach((_name) => {
            // Resolve name
            const name = this.resolveName(_name);

            // Create namespace if not exist
            if (!(this.callbacks[name.namespace] instanceof Object)) {
                this.callbacks[name.namespace] = {};
            }

            // Create callback array if not exist
            if (!(this.callbacks[name.namespace][name.value] instanceof Array)) {
                this.callbacks[name.namespace][name.value] = [];
            }

            // Add callback
            this.callbacks[name.namespace][name.value].push(callback);
        });

        return this;
    }

    public off(_names: string): this {
        // Errors
        if (typeof _names === 'undefined' || _names === '') {
            console.warn('wrong name');
            return this;
        }

        // Resolve names
        const names = this.resolveNames(_names);

        // Each name
        names.forEach((_name) => {
            // Resolve name
            const name = this.resolveName(_name);

            // Remove namespace
            if (name.namespace !== 'base' && name.value === '') {
                delete this.callbacks[name.namespace];
            } else {
                // Default
                if (name.namespace === 'base') {
                    // Try to remove from each namespace
                    for (const namespace in this.callbacks) {
                        if (this.callbacks[namespace] instanceof Object &&
                            this.callbacks[namespace][name.value] instanceof Array) {
                            delete this.callbacks[namespace][name.value];

                            // Remove namespace if empty
                            if (Object.keys(this.callbacks[namespace]).length === 0) {
                                delete this.callbacks[namespace];
                            }
                        }
                    }
                } else if (this.callbacks[name.namespace] instanceof Object &&
                    this.callbacks[name.namespace][name.value] instanceof Array) {
                    delete this.callbacks[name.namespace][name.value];

                    // Remove namespace if empty
                    if (Object.keys(this.callbacks[name.namespace]).length === 0) {
                        delete this.callbacks[name.namespace];
                    }
                }
            }
        });

        return this;
    }

    public trigger(_name: string, _args?: any[]): any {
        // Errors
        if (typeof _name === 'undefined' || _name === '') {
            console.warn('wrong name');
            return false;
        }

        let finalResult: any = null;
        let result: any = null;

        // Default args
        const args: any[] = !(_args instanceof Array) ? [] : _args;

        // Resolve names (should only have one event)
        const names = this.resolveNames(_name);
        const name = this.resolveName(names[0]);

        // Default namespace
        if (name.namespace === 'base') {
            // Try to find callback in each namespace
            for (const namespace in this.callbacks) {
                if (this.callbacks[namespace] instanceof Object &&
                    this.callbacks[namespace][name.value] instanceof Array) {
                    this.callbacks[namespace][name.value].forEach((callback) => {
                        result = callback.apply(this, args);

                        if (typeof finalResult === 'undefined') {
                            finalResult = result;
                        }
                    });
                }
            }
        } else if (this.callbacks[name.namespace] instanceof Object) {
            if (name.value === '') {
                console.warn('wrong name');
                return this;
            }

            this.callbacks[name.namespace][name.value].forEach((callback) => {
                result = callback.apply(this, args);

                if (typeof finalResult === 'undefined') {
                    finalResult = result;
                }
            });
        }

        return finalResult;
    }

    private resolveNames(_names: string): string[] {
        let name = _names;
        name = name.replace(/[^a-zA-Z0-9 ,/.]/g, '');
        name = name.replace(/[,/]+/g, ' ');
        const names : string[] = name.split(' ');

        return names;
    }

    private resolveName(name: string): Name {
        const parts = name.split('.');
        return {
            original: name,
            value: parts[0],
            namespace: parts.length > 1 && parts[1] !== '' ? parts[1] : 'base'
        };
    }
}
