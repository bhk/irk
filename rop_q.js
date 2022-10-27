import { Agent, Pool } from "./rop.js";
import { connect, flushEvents } from "./mockdom.js";
import test from "./test.js";
import assert from "assert";
import {
    use, wrap, useError, usePending, Pending, checkPending,
    newCell, newState, logCell, getCurrentCell, valueText
} from "./i.js";
let { eq, eqAt, printf } = test;

let isPending = (value) => use(value) == "PENDING";

// TODO:
//  - treat Pending as error state, not "PENDING"
//     - enable `isError` detection without "use"
//  - propagate error state through tunnel
//  - deal with protocol errors
//  - identify constant results
//  - connection authentication
//  - connection re-establishment (?)
//  - object passing (to another tunnel)
//  - test ping [validation; profiling]

// In Rio, ignoring the time for events to "settle", we would write ...
//
//     f = clientAgent.getRemote(0)
//     assert f(1,2) == 3
//
// ... but in JS we work in the reactive domain and the imperative domain,
// and in testing we deal with event loop simulation:
//
//  - Some functions expect to be called in the reactive domain (i.e.
//    "inside" a "current cell").  We have to create a root cell and enter
//    it with use(cell) or activate(cell).
//
//  - Some values are represented as cells, so we have to call `use()`
//    if we want a raw value.
//
//  - `flushEvents` dispatches events from the simulated event queue.
//

let newLogger = (prefix) => (...a) => console.log(prefix + ":", ...a);
let log = newLogger("rop_q");
let clog = (cell, opts) => logCell(cell, {...opts, log});

let flushEQ = (root, value) => {
    flushEvents();
    eqAt(2, root.result, value);
};

// Invoke fn(...args) in a cell, returning:
//   [false, pendingValue] if in progress
//   [true, result] if complete
//
let pcell = (fn, ...args) => {
    let inner = newCell(fn, ...args);
    let c = newCell(() => usePending(inner));
    c.name = "pcell";
    use(c);
    return c;
};

let logRecalc = () => {
    let r = getCurrentCell();
    let rr = r.recalc.bind(r);
    r.recalc = () => { clog(); rr(); }
};

//----------------------------------------------------------------
// Tests
//----------------------------------------------------------------

// test Pool

{
    let p = new Pool();
    eq(p.alloc(), 0);
    eq(p.countUsed, 1);
    p.free(0);
    eq(p.nextEmpty, 0);
    eq(p.countUsed, 0);
    eq(p.alloc(), 0);
    eq(p.countUsed, 1);

    let cell = newCell(() => p.add(9));
    let ndx = use(cell);
    eq(p[ndx], 9);
    eq(p.countUsed, 2);
    cell.deactivate();
    eq(p.countUsed, 1);
}

// test Agent

let wsClient = new WebSocket();
let wsServer = new WebSocket();

// client agent is constructed with ws in CONNECTING state
let ca = new Agent(wsClient);
// ca.log = newLogger("CAgent");
connect(wsServer, wsClient);
flushEvents();

// we construct the server agent with ws in OPEN state
let serverState1 = newState("initial");
let serverFuncs = {
    add: (x, y) => x + y,
    state: () => serverState1,
    funcTest: (fa, fb) => ["ok", fa, fb, use(fa()) + use(fb())],
};
let sa = new Agent(wsServer, Object.values(serverFuncs));
// sa.log = newLogger("SAgent");
let remote = (name) =>
    ca.getRemote(Object.keys(serverFuncs).indexOf(name));

// test: observe simple remote function (simple, non-reactive)

{
    let frAdd = remote("add");
    let cell = pcell(frAdd, 1, 2);
    eq([false, "opening"], use(cell));
    flushEQ(cell, [true, 3]);
    eq(ca.slotsOut.countUsed, 1);
    cell.deactivate();
    flushEvents();
    eq(ca.slotsOut.countUsed, 0);
}

// test: observe remote state cell

{
    let f1 = remote("state");
    let cell = pcell(() => f1());
    flushEQ(cell, [true, "initial"]);

    eq(ca.slotsOut.countUsed, 1);
    eq(sa.slotsIn[0] == null, false);
    eq(serverState1.parents.size, 1);

    serverState1.set(7);
    flushEQ(cell, [true, 7]);
    cell.deactivate();
    flushEvents();

    eq(serverState1.parents.size, 0);
    eq(ca.slotsOut.countUsed, 0);
    eq(sa.slotsIn[0], null);
}

// test: function args, results, and invocation of forwarders

{
    serverState1.set("xyz");
    let ncc = ca.caps.countUsed;
    let ncs = sa.caps.countUsed;

    let localFunc = () => "abc";

    let cell = pcell(() => {
        let rmtState = remote("state");
        let rmtTest = remote("funcTest");
        let result = use(rmtTest(localFunc, rmtState));
        if (typeof result == "string") {
            throw new Pending(result);
        }
        assert(result instanceof Array);
        let [ok, localFuncOut, rmtStateOut, catOut] = result;
        eq(ok, "ok");
        // ASSERT: localFunc is unwrapped on return
        eq(localFuncOut, localFunc);
        // ASSERT: remote function is equivalent after round trip
        let st = use(rmtStateOut());
        eq(catOut, "abc" + st);
        return st;
    });

    eq(use(cell), [false, "opening"]);

    flushEQ(cell, [true, "xyz"]);
    eq(sa.caps.countUsed, ncs+1);
    eq(ca.caps.countUsed, ncc+1);
    serverState1.set("def");
    flushEQ(cell, [true, "def"]);

    // check that caps[] entries (allocated OIDs) are freed
    cell.deactivate();
    flushEvents();
    eq(sa.caps.countUsed, ncs);

    eq(ca.caps.countUsed, ncc);
}
