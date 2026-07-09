export function addEmitter(obj) {
    const handlers = new Map();
    let nextId = 1;

    obj.connect = (signal, cb) => {
        if (!handlers.has(signal)) handlers.set(signal, new Map());
        const id = nextId++;
        handlers.get(signal).set(id, cb);
        return id;
    };

    obj.disconnect = (id) => {
        for (const set of handlers.values()) {
            if (set.delete(id)) return true;
        }
        return false;
    };

    obj.emit = (signal, ...args) => {
        const set = handlers.get(signal);
        if (!set) return;
        for (const cb of set.values()) cb(...args);
    };

    obj._disconnectAll = () => handlers.clear();

    return obj;
}
