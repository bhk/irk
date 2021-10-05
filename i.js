// Incremental: incremental evaluation (see incremental.txt)
//
// High-level API: Used by functional code
//
//    defer(f)             Construct a thunk (lazy value)
//    demand(v)            Extract value from thunk (if a thunk)
//    isThunk(v)           Return true if `v` is a thunk
//    memo(f)(...args)     Decouple evaluation of f(...args), memoizing
//    deferMemo(f)(...a)   Equivalent to defer(_ => memo(f)(...args))
//    latch(v, fn)         Compute value from previous value.
//
// Low-level API: Used by imperative code
//
//    onDrop(f)            Register f() to perform cleanup
//    newState()
//    newRoot()
//    activate()
//    inRoot()
//    isolate(f)           Decouple evaluation of f(), without memoizing


//------------------------------------------------------------------------
// Map a function and argument array to a unique value.
//------------------------------------------------------------------------

const gRootKey = new Map();


const findMap = (map, key) => {
    let m = map.get(key);
    if (m == null) {
        m = new Map();
        map.set(key, m);
    }
    return m;
}


const createNodeKey = (f, args) => {
    let map = findMap(gRootKey, f);
    args.forEach(a => map = findMap(map, a));
    return map;
}


//------------------------------------------------------------------------
// CaughtError
//------------------------------------------------------------------------


class CaughtError {
    constructor(e) {
        this.e = e;
    }
}


//------------------------------------------------------------------------
// Thunk & FnThunk
//------------------------------------------------------------------------


class Thunk {
}


class FnThunk extends Thunk {
    constructor(f) {
        super();
        this.f = f;
    }

    get() {
        return this.f.call(null);
    }
}


// Create a thunk that will be unwrapped by `demand`.
//
const defer = (f) => new FnThunk(f);


// If value is a thunk, evaluate it.  Otherwise, return it.
//
const demand = (value) => {
    while (value instanceof Thunk) {
        value = value.get();
    }
    return value;
}


const isThunk = (value) => {
    return value instanceof Thunk;
}


//------------------------------------------------------------------------
// INode
//------------------------------------------------------------------------
//
// An `INode` represents a function call and its cached result.  INodes
// form a directed acyclic graph, acting as parents and/or children.  In
// the general case, "function" INodes act as parents and children.
// "State" INodes are only children.
//
// Parents implement:
//    setDirty()
//    addChild(node, result)
//
// Children implement:
//    get()              : update() & log as dependency of currentNode
//    update()           : freshen & return current value
//    addParent()
//    removeParent()
//


// currentNode holds the node currently being evaluated.  Initialized below.
let currentNode;

let errors = [];


// table for caching nodes
const nodeCache = new Map();


class INode extends Thunk {

    constructor(f, args, key) {
        super();

        // Generic child node properties
        this.parents = new Set();
        this.result = null;
        this.isDirty = true;     // true => result is valud; false => maybe not

        // Function node properties
        this.f = f;              // const
        this.args = args;        // const
        this.key = key;          // const

        // Parent node properties
        // children: null => never been evaluated
        //           Map => all logged deps (node -> result)
        this.children = null;
        this.cleanups = [];
    }


    setDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            for (const p of this.parents) {
                p.setDirty();
            }
        }
    }


    // A parent's addChild() is called when a dependency is logged against it.
    // We give the parent responsibility for calling `child.addParent` because
    // the parent must be responsible for calling `child.removeParent`.
    //
    addChild(child, value) {
        // children==null ==> we are not running within `get`, which only
        // happens in when `this` is an implicit global root.
        if (this.children != null) {
            this.children.set(child, value);
        }
        child.addParent(this);
    }


    // Call all registered `onDrop` functions.
    //
    cleanup() {
        // Process cleanups in LIFO order
        for (let i = this.cleanups.length - 1; i >= 0; --i) {
            this.cleanups[i].call(null);
        }
        this.cleanups = [];
    }


    // Register a function to be called after the node is discarded or before it
    // is re-evaluated.
    //
    onDrop(cbk) {
        this.cleanups.push(cbk);
    }


    // De-activate node, since it is no longer "live".
    //
    drop() {
        this.cleanup();

        // remove from memo table
        if (this.key) {
            nodeCache.delete(this.key);
        }

        // detach from children
        if (this.children != null) {
            for (const [child, result] of this.children) {
                child.removeParent(this);
            }
            this.children = null;
        }
    }


    addParent(p) {
        this.parents.add(p);
    }


    removeParent(p) {
        this.parents.delete(p);
        if (this.parents.size == 0) {
            this.drop();
        }
    }


    // Return result & log this node and its result as a depedendency of
    // currentNode.
    //
    get() {
        const result = this.update();
        currentNode.addChild(this, result);
        if (result instanceof CaughtError) {
            throw result.e;
        } else {
            return result;
        }
    }


    // Update: Compute result, re-calculating if necessary (without logging
    // this node as a dependency of its caller).
    //
    update() {
        if (!this.isDirty) {
            return this.result;
        }

        // Update all children.  If they return the same result as before,
        // then this node remains valid.
        //
        let isValid = false;
        if (this.children != null) {
            // Validate nodes in the order they were first evaluated,
            // because decision points generally precede more costly
            // oprations.  E.g.  if (MODE) A(); else B();
            isValid = true;
            for (const [node, result] of this.children) {
                let value = node.update();
                // Re-throwing errors in this phase does not seem to work.
                if (value instanceof CaughtError) {
                    errors.push(value);
                }
                if (result !== value) {
                    if (this.debugInval) {
                        const thisName = this.name || String(this.f);
                        const nodeName = node.name || String(node.f);
                        console.log("Inval " + thisName + " due to " + nodeName + ": "
                                    + String(result) + " -> " + String(value));
                    }
                    isValid = false;
                    break;
                }
            }
        }

        if (isValid) {
            this.isDirty = false;
        } else {
            this.recalc();
        }
        return this.result;
    }


    // Call f(args), watching for creation of child nodes
    //
    recalc() {
        this.cleanup();

        const oldChildren = this.children;
        this.children = new Map();

        const saveCurrentNode = currentNode;
        currentNode = this;
        try {
            this.result = this.f.apply(null, this.args);
        } catch (e) {
            this.result = new CaughtError(e);
        }
        currentNode = saveCurrentNode;

        if (oldChildren != null) {
            for (const [child, value] of oldChildren) {
                if (!this.children.has(child)) {
                    child.removeParent(this);
                }
            }
        }

        this.isDirty = false;
    }
}


// Find a matching node or create a new one.
//
const findNode = (f, args) => {
    const key = createNodeKey(f, args);
    let node = nodeCache.get(key);
    if (!node) {
        node = new INode(f, args, key);
        nodeCache.set(key, node);
    }
    return node;
}


//----------------------------------------------------------------
// INode-related APIs
//----------------------------------------------------------------

const I = {};


// De-couple evaluation of f(...args) from that of the caller, returning the
// result.  This can prevent propagation of invalidation in both directions:
// Changes that invalidate `f(...args)` will not invalidate the caller will
// not necessarily invalidate the caller.  The resulting node is memoized,
// so invalidation of the caller will not necessarily discard or re-evaluate
// `f(...args)`.
//
const memo = (f) => (...args) => findNode(f, args).get();


// `deferMemo(f)()` is equivalent to `defer(_ => memo(f)(...a))` but
// more efficient.
//
const deferMemo = (f) => (...args) => findNode(f, args);


// De-couple evaluation of f() without memoizing, returning the result.
// This prevents propagation of invalidation downstream.  Changes that
// invalidate `f(...args)` will not invalidate the caller will not
// necessarily invalidate the caller.  Invalidation of the caller will
// always re-evaluated `f(...args)`.
//
// This is often used to de-couple functions that set external state, which
// typically will never invalidate their caller.
//
const isolate = (f) => new INode(f, []).get();

const deferIsolate = (f) => new INode(f, []);


// Call `fn` passing it its previous return value (or `initial` the first
// time it is called), an return its result.
//
const latch = (initial, fn) => {
    // get/create map in current node
    let map = currentNode.latches;
    if (map == undefined) {
        currentNode.latches = map = new Map();
    }

    // Hack: use String(fn) as key...
    let key = String(fn);
    let newValue = fn(map.has(key) ? map.get(key) : initial);
    map.set(key, newValue);
    return newValue;
};


// Provide a function to be called when the current node is deleted or
// re-evaluated.
//
const onDrop = (f) => currentNode.onDrop(f);


// Return node that is currently being evaluated.
//
const getCurrentNode = () => currentNode;


const debug = (f) => {
};


// Return a root node, which implements the following methods:
//   get() : get the current value
//   drop() : discard all child nodes and perform all cleanup
//
const newRoot = (f, dirtyCB) => {
    const node = new INode(f, []);
    const parent = {
        setDirty: dirtyCB,
        addChild: () => {},
    };
    node.addParent(parent);

    return node;
}


//----------------------------------------------------------------
// Global root
//----------------------------------------------------------------
//
// We need a valid root node to be able to execute many of our exported
// functions.  Generally such code should execute within an
// explicitly-created root so that cleanup will be done properly, but module
// initialization code may use functions that call `onDrop`, and modules are
// never unloaded anyway.  For that use case, we have a default "global"
// root.  (However, one can imagine a future in which module loading is
// I-aware and unused modules can be automatically unloaded, and this global
// root is unnecessary.)


currentNode = newRoot(_ => {}, _ => {});


//------------------------------------------------------------------------
// State
//------------------------------------------------------------------------


// A state object is a child but not a parent.
//
class IState extends INode {
    constructor(initial) {
        super();
        this.result = initial;
    }

    set(value) {
        if (value !== this.result) {
            this.result = value;
            this.setDirty();
        }
    }

    update() {
        // clear dirty flag to enable notifications of parents
        this.isDirty = false;
        return this.result;
    }
}


const newState = (initial) => new IState(initial);


//------------------------------------------------------------------------
// Streams
//------------------------------------------------------------------------


class StreamEntry {
    // Append event (given this=tail) and return new tail.
    appendEntry(evt) {
        this.event = evt;
        return (this.next = new StreamEntry());
    }

    forEachSince(prev, fn) {
        for (let o = prev; o != null && o.event && o !== this; o = o.next) {
            fn(o.event);
        }
    }

    getValuesSince(prev) {
        const a = [];
        this.forEachSince(prev, e => a.push(e));
        return a;
    }
}


// Create a writable stream (thunk & node).
//
// stream.append(value) appends values to the stream.  It is a function and
// does not need to be invoked as a method.
//
const newStream = () => {
    let tail = new StreamEntry();
    const stream = newState(tail);

    stream.append = (value) => {
        tail = tail.appendEntry(value);
        stream.set(tail);
    };
    return stream;
};


// Generate one stream from another.  `xform` is passed an array containing
// all new entries in `stream`; it returns an array of entries for the
// resulting stream.
//
// filterStream: Stream a -> ([a] -> [b]) -> Stream b
// xform: [...a] -> [...b]
//
const filterStream = (stream, xform) => {
    let tail = new StreamEntry();
    let prevPos = null;

    // TODO: deferIsolate
    return deferIsolate(_ => {
        const pos = stream.get();
        const current = xform(pos.getValuesSince(prevPos));
        prevPos = pos;
        for (const item of current) {
            tail = tail.appendEntry(item);
        }
        return tail;
    });
};


// The (lazy) most recent value in the stream.
//
const mostRecent = (stream, initial) => {
    let prevPos = undefined;
    let recent = initial;
    return deferIsolate(_ => {
        const pos = stream.get();
        pos.forEachSince(prevPos, item => {
            recent = item;
        });
        prevPos = pos;
        return recent;
    });
};


//------------------------------------------------------------------------
// Misc.
//------------------------------------------------------------------------

// Evaluate and continue to re-evaluate `fn` asynchronously (forever).
//
const activate = (fn) => {
    let root;
    const update = () => {
        root.get();
        if (errors[0]) {
            let e = errors[0];
            errors = [];
            throw e;
        }
    };

    root = newRoot(fn, () => setTimeout(update));
    update();
};


// Execute `fn()` in the context of a new root, then clean up.
//
const inRoot = (fn) => {
    const root = newRoot(fn, () => {});
    const result = root.get();
    root.drop();
    return result;
};


//------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------


export {
    // High-level
    defer,
    demand,
    isThunk,
    memo,
    deferMemo,
    isolate,
    deferIsolate,
    latch,

    // Low-level API
    onDrop,
    newState,
    newRoot,
    activate,
    inRoot,

    // streams
    newStream,
    filterStream,
    mostRecent,

    // for testing
    getCurrentNode,
    createNodeKey,
};
