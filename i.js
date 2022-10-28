// Incremental: incremental evaluation (see incremental.txt)
//
// High-level API: Used by functional code
//
//    defer(f)            Construct a thunk (lazy value)
//    use(v)              Extract value from cell or thunk
//    isThunk(v)          Return true if `v` is a thunk or cell
//    wrap(f)(...)        Evaluate f(...) inside a cell
//    wrap(f).cell(...)   Return the cell that evaluates f(...)
//    useError(c)         Return [succeeded, result/thrownvalue]
//    usePending(c)       Return [done, result/pendingvalue]
//    Pending             A class describes temporary failures
//    checkPending(e)     value, if root cause of `e` was `new Pending(value)`
//    rootCause(e)        Dereference `cause` in Error objects, transitively
//
// Low-level API: Used by imperative code
//
//    newState()          Create new state cell
//    newCell()           Create new function cell
//    onDrop(f)           Call f() when current cell's value is discarded
//    activate(f)         Decouple evaluation of f(), without memoizing
//
// Experimental:
//
//    latch(v, fn)
//    newStream()
//    filterStream(stream, xform)
//    mostRecent(stream, initial)
//

import {intern} from "./intern.js";

const assert = (cond) => {
    if (!cond) {
        throw new Error("Assertion failed");
    }
};

const cache = (map, key, fn) => {
    let v;
    return map.has(key) ? map.get(key) : (v = fn(), map.set(key, v), v);
};

//------------------------------------------------------------------------
// Exceptions
//------------------------------------------------------------------------

// CellException is used to distinguish a cell in error state from all
// other possible cell values.

class CellException {
    constructor(error) {
        this.error = error;
    }
}

// A Pending object is thrown to indicate that an failure is temporary.
//
//  A) throw new Pending("connecting");
//  B) throw new Error("pending", { cause: Pending("connecting") });
//  C) stateCell.setError(Pending("connecting"));
//
// (B) will generate a stack trace for the `throw` expression, while (A)
// will not.  (C) will generate an error (and stack trace) when the state
// cell is used.
//
class Pending {
    constructor(value) {
        this.value = value;
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

// Create a thunk that will be unwrapped by `use`.
//
const defer = (f) => new FnThunk(f);

// Force evaluation of a value.
//
const unthunk = (value) => {
    while (value instanceof Thunk) {
        value = value.get();
    }
    return value;
};

const rootCause = (e) => {
    while (e instanceof Error && e.cause) {
        e = e.cause;
    }
    return e;
};

// Recover `value` if error resulted from `throw new Pending(value)`
//
const checkPending = (error) => {
    const cause = rootCause(error);
    if (cause instanceof Pending) {
        return cause.value;
    }
};

// Force evaluation and throw if value is in error state.
//
const use = (value) => {
    value = unthunk(value);
    if (value instanceof CellException) {
        throw new Error("used error value", {cause: value.error});
    }
    return value;
};

// Return [true, RESULT] or [false, THROWNVALUE]
//
const useError = (value) => {
    const v = unthunk(value);
    return (v instanceof CellException
            ? [false, rootCause(v.error)]
            : [true, v]);
};

// Return [true, RESULT] or [false, PENDINGVALUE]  (rethrow other errors)
//
const usePending = (value) => {
    const v = unthunk(value);
    const p = v instanceof CellException && checkPending(v.error);
    return (p
            ? [false, p]
            : [true, use(v)]);
};

const isThunk = (value) => {
    return value instanceof Thunk;
};

//------------------------------------------------------------------------
// Cell
//------------------------------------------------------------------------
//
// A `Cell` describes a node in a dependency graph.  Cells may have children
// (other cells on whose results they depend) and parents (cells that depend
// on their results).  "Function cells" act as parents and children.  "State
// cells" are only children.  "Root cells" are only parents.
//
// All cells implement implement the "child cell" interface:
//    update()
//    get()
//    addParent()
//    removeParent()
//
// Cells that depend on other cells implement the "parent cell" interface:
//    setDirty()
//    addChild(cell, result)
//    removeChild()
//

class Cell extends Thunk {
    constructor(value, isDirty) {
        super();
        this.isDirty = isDirty;
        this.result = value;
        this.parents = new Set();
    }

    setDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            for (const p of this.parents) {
                p.setDirty();
            }
        }
    }

    addParent(p) {
        this.parents.add(p);
    }

    removeParent(p) {
        this.parents.delete(p);
    }
}

//------------------------------------------------------------------------
// StateCell
//------------------------------------------------------------------------
//
// StateCell implements the "child cell" interface.
//

class StateCell extends Cell {
    constructor(initial) {
        super(intern(initial), false);
    }

    set(value) {
        value = intern(value);
        if (value !== this.result) {
            this.result = value;
            this.setDirty();
        }
    }

    setError(e) {
        this.set(new CellException(e));
    }

    update() {
        this.isDirty = false;
        return this.result;
    }

    get() {
        const result = this.update();
        currentCell.addChild(this, result);
        return result;
    }
}

const newState = (initial) => new StateCell(initial);

//------------------------------------------------------------------------
// FunCell
//------------------------------------------------------------------------

// currentCell holds the cell currently being evaluated.  Initialized below.
let currentCell;

// table for caching cells
const cellCache = new Map();

class FunCell extends Cell {
    constructor(f, args, key) {
        // isDirty is tri-state:
        //   false => result is valid
        //   true => may need recalc (validate children)
        //   "new" => needs recalc (has never been evaluated)
        super(null, "new");

        this.f = f;              // const
        this.args = args;        // const
        this.key = key;          // const
        this.children = null;
        this.cleanups = null;
    }

    // Return result & log this cell and its result as a depedendency of
    // currentCell.
    //
    get() {
        const result = this.update();
        // If, after evaluation, we have no resources to clean up and we
        // weren't memoized, then we don't need to track this dependency.
        if (this.children || this.cleanups || this.key) {
            currentCell.addChild(this, result);
        }
        return result;
    }

    // Called after our parent has removed us...
    removeParent(p) {
        this.parents.delete(p);
        if (this.parents.size == 0) {
            this.drop();
        }
    }

    // add/removeChild(c) call c.add/removeParent()
    addChild(child, value) {
        if (this.children == null) {
            this.children = new Map();
        }
        this.children.set(child, value);
        child.addParent(this);
    }

    removeChild(child) {
        this.children.delete(child);
        child.removeParent(this);
    }

    // Call all registered `onDrop` functions.
    //
    cleanup() {
        if (this.cleanups) {
            // Process cleanups in LIFO order
            for (const f of this.cleanups.reverse()) {
                f();
            }
            this.cleanups = null;
        }
    }

    // Register a function to be called after the cell is discarded or before it
    // is re-evaluated.
    //
    onDrop(cbk) {
        if (!this.cleanups) {
            this.cleanups = [];
        }
        this.cleanups.push(cbk);
    }

    // Discard result, call onDrop handlers, disown children.
    // Called when this is no longer "live".
    //
    drop() {
        this.cleanup();

        // remove from memo table
        if (this.key) {
            cellCache.delete(this.key);
        }

        // detach from children
        if (this.children != null) {
            for (const [child, result] of this.children) {
                child.removeParent(this);
            }
            this.children = null;
        }
    }

    // Remove cell from all parents.  This indirectly triggers this.drop().
    deactivate() {
        for (const parent of [...this.parents]) {
            parent.removeChild(this);
        }
    }

    // Update: Recalculate if necessary.
    update() {
        if (!this.isDirty) {
            return this.result;
        }

        let isInvalid = false;

        if (this.isDirty == "new") {
            // node has not been calculated
            isInvalid = true;
        } else if (this.children) {
            // Validate cells in the order they were first evaluated,
            // to avoid recalculating un-live cells.
            for (const [cell, result] of this.children) {
                const value = cell.update();
                if (result !== value) {
                    isInvalid = true;
                    break;
                }
            }
        }

        this.isDirty = false;
        if (isInvalid) {
            this.recalc();
            assert(this.isDirty == false);
        }
        return this.result;
    }

    // Call f(args), watching for creation of child cells
    //
    recalc() {
        this.cleanup();

        const oldChildren = this.children;
        this.children = null;

        const saveCurrentCell = currentCell;
        currentCell = this;
        try {
            this.result = intern(this.f.apply(null, this.args));
        } catch (e) {
            this.result = new CellException(e);
        }
        currentCell = saveCurrentCell;

        if (oldChildren != null) {
            // A cell cannot transition from some children to *none*
            // unless there is an untracked dependency.
            assert(this.children);
            for (const [child, value] of oldChildren) {
                if (!this.children.has(child)) {
                    child.removeParent(this);
                }
            }
        }
    }
}

// Find a matching cell or create a new one.
//
const findCell = (f, args) => {
    args = intern(args);
    const key = intern([f, args]);
    return cache(cellCache, key, () => new FunCell(f, args, key));
}

//----------------------------------------------------------------
// RootCell
//----------------------------------------------------------------

// A RootCell has no parents and is self-updating.
//
class RootCell extends FunCell {
    constructor() {
        // `f` and `args` are never referenced in RootCell
        super();
        this.isDirty = false;
        // this fake parent exists only to trigger updates
        this.addParent({
            setDirty: () => setTimeout(_ => use(this))
        });
    }

    // override get() to not add any parents
    get() {
        return this.update();
    }

    // preserve children and update them; don't call onDrops
    recalc() {
        if (this.children) {
            for (const [child, _] of this.children) {
                use(child);
            }
        }
    }
};

// The globalRoot cell acts as parent for all cell evaluations that occur
// outside of the scope of another cell's update.
const globalRoot = new RootCell();
currentCell = globalRoot;

//----------------------------------------------------------------
// Cell-related APIs
//----------------------------------------------------------------

// Return cell that is currently being evaluated.
const getCurrentCell = () => currentCell;

// De-couple evaluation of f() without memoizing, returning the result.
// This prevents propagation of invalidation downstream.  Changes that
// invalidate `f(...args)` will not invalidate the caller will not
// necessarily invalidate the caller.  Invalidation of the caller will
// always re-evaluated `f(...args)`.
//
// This is often used to de-couple functions that set external state, which
// typically will never invalidate their caller.
//

const newCell = (f, ...args) => new FunCell(f, args);

const activate = (f, ...args) => {
    const cell = new FunCell(() => {f(...args);});
    use(cell);     // make it a dependency
    return cell;
};

// Provide a function to be called when the current cell is deleted or
// re-evaluated.
//
const onDrop = (f) => currentCell.onDrop(f);

// Create or locate an existing cell that evaluates f(...args).
//
// If `fw = wrap(f)`, then:
//    `fw(...args)` obtains *and uses* a cell that evaluates f(...args)
//    `fw.cell(...args)` just returns the cell without calling `use`.
//
const wrap = (f) => {
    const useCell = (...args) => use(findCell(f, args));
    useCell.cell = (...args) => findCell(f, args);
    return useCell;
};

//------------------------------------------------------------------------
// Latch
//------------------------------------------------------------------------

// Call `fn` passing it its previous return value (or `initial` the first
// time it is called), an return its result.
//
const latch = (initial, fn) => {
    // get/create map in current cell
    let map = currentCell.latches;
    if (map == undefined) {
        currentCell.latches = map = new Map();
    }

    // Hack: use String(fn) as key...
    const key = String(fn);
    const newValue = fn(map.has(key) ? map.get(key) : initial);
    map.set(key, newValue);
    return newValue;
};

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

// Create a writable stream (thunk & cell).
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

    return newCell(_ => {
        const pos = use(stream);
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
    return newCell(_ => {
        const pos = use(stream);
        pos.forEachSince(prevPos, item => {
            recent = item;
        });
        prevPos = pos;
        return recent;
    });
};

//------------------------------------------------------------------------
// Diagnostics: logCell
//------------------------------------------------------------------------

const objIDs = new Map();

const getID = v => cache(objIDs, v, () => objIDs.size);

const cellName = (cell) => {
    const name =
          cell.name ? cell.name :  // may be set for debugging
          cell instanceof RootCell ? "root" :
          cell instanceof StateCell ? "state" :
          cell.key ? "wrap" :
          "cell";
    return name + String(getID(cell));
};

const objName = (obj) =>
      Object.getPrototypeOf(obj).constructor.name
      + " " + (obj.name ?? "#" + getID(obj));

const valueTextAt = (depth, v, r) =>
      depth > 9 ? "..." :
      v instanceof Object ? (
          (v instanceof Cell ? cellName(v) :
           v instanceof CellException ? `<Caught ${r(v.error)}>` :
           v instanceof Pending ? `<Pending ${r(v.value)}>` :
           v instanceof Function ? (v.name
                                    ? `${v.name}#${getID(v)}`
                                    : `<Fn#${getID(v)}>`) :
           v instanceof Error ? `<Error ${r(v.cause ?? v.message)}>` :
           v instanceof Array ? (depth == 0 ? `[${v.map(r)}]` : `[...]`) :
           `<${objName(v)}>`)) :
      typeof v == "string" ? '"' + v.replace(/\n/g, "\\n") + '"' :
      String(v);

const valueText = (v) => {
    const rr = depth => v => valueTextAt(depth, v, rr(depth+1));
    return rr(0)(v);
};

const showTree = (start, getChildren, getText, logger) => {
    const recur = (node, prefix1, prefix) => {
        getText(node).forEach((line, num) => {
            logger((num==0 ? prefix1 : prefix) + line);
        });
        const a = [...getChildren(node)];
        a.forEach( (child, ndx) => {
            recur(child,
                  prefix + " + ",
                  prefix + (ndx + 1 == a.length ? "   " : " | "));
        });
    };
    recur(start, "* ", "  ");
};

const logCell = (root, options) => {
    root ??= (root === null ? globalRoot : currentCell);
    options ??= {};

    const getCellText = (cell) => {
        const name = cellName(cell);
        const value = valueText(cell.result);
        const dirty = cell.isDirty ? "! " : "";
        const out = [`${name}: ${dirty}${value}`];
        if (!options.brief && cell.f && cell.args
            && (cell.f.name || cell.args.length > 0)) {
            const fname = cell.f.name || "<f>";
            const fargs = cell.args.map(valueText);
            const ch = (cell.key ? "&" : "=");
            out.push(`  ${ch} ${fname}(${fargs})`);
        }
        if (cell.cleanups) {
            out.push(`  cleanups: ${cell.cleanups.length}`);
        }
        return out;
    };

    showTree(root,
             c => (c.children ?? []).keys(),
             getCellText,
             options.log || console.log.bind(console));
};

//------------------------------------------------------------------------
// Exports
//------------------------------------------------------------------------

export {
    // High-level
    defer,
    use,
    isThunk,
    wrap,
    useError,
    usePending,
    checkPending,
    Pending,
    rootCause,

    // Low-level API
    newState,
    newCell,
    onDrop,
    activate,

    // experimental
    latch,
    newStream,
    filterStream,
    mostRecent,

    // for testing & diagnostics
    getCurrentCell,
    logCell,
    valueText,
};
