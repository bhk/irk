// intern.js: find a canonical, immutable, equivalent value

class Step {
    constructor(elem, prev) {
        this.elem = elem;
        this.prev = prev;
        this.nexts = new Map();
        this.value = undefined;
    }

    next(elem) {
        if (this.nexts.has(elem)) {
            return this.nexts.get(elem);
        } else {
            const es = new Step(elem, this);
            this.nexts.set(elem, es);
            return es;
        }
    }
}

const interns = new Map();
const emptyArray = new Step();
const emptyObject = new Step();
const objectProto = Object.getPrototypeOf({});

const internArray = (a) => {
    let step = emptyArray;
    for (const e of a) {
        step = step.next(intern(e));
    }
    if (step.value) {
        return step.value;
    }

    // create `ai` whose elements are all interned
    let ai = new Array(a.length);
    let rs = step;
    for (let i = a.length - 1; i >= 0; --i, rs = rs.prev) {
        ai[i] = rs.elem;
    }
    ai = Object.freeze(ai);
    interns.set(ai, step);
    step.value = ai;
    return ai;
};

const internObject = (obj) => {
    let step = emptyObject;
    for (const [k,v] of Object.entries(obj)) {
        step = step.next(k).next(intern(v));
    }
    if (step.value) {
        return step.value;
    }

    // create `obji` whose properties are all interned
    let obji = {};
    for (let rs = step; rs !== emptyObject; ) {
        const v = rs.elem;
        rs = rs.prev;
        const k = rs.elem;
        rs = rs.prev;
        obji[k] = v;
    }
    obji = Object.freeze(obji);
    interns.set(obji, step);
    step.value = obji;
    return obji;
};

// If `value` is an object whose constructor is `Array` or `Object`, return
// an immutable, canonical equivalent.  Otherwise, return `value`.
//
// Bug: Interned values accummulate in memory indefinitely.
//
const intern = (value) => {
    return !(value instanceof Object) ? value :
        interns.has(value) ? value :
        value instanceof Array ? internArray(value) :
        Object.getPrototypeOf(value) == objectProto ? internObject(value) :
        value;
};

export { intern }
