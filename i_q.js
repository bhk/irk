import test from "./test.js";
let {eq, assert} = test;

import {
    defer, demand, isThunk,
    memo, deferMemo, isolate, latch,
    onDrop, newState, newRoot, inRoot,
    getCurrentNode, createNodeKey,
} from "./i.js";


// defer, demand

eq(2, demand(2));
eq(null, demand(null));
eq({}, demand({}));
const ff = a => a*2;
eq(ff, demand(ff));

eq(2, demand(defer(_ => 2)));
eq(ff, demand(defer(_ => ff)));


// createNodeKay

assert(createNodeKey(1, []) != createNodeKey(2, []));
assert(createNodeKey(1, []) != createNodeKey(1, [2]));
assert(createNodeKey(1, [2]) != createNodeKey(1, [2,3]));
assert(createNodeKey(1, [2]) == createNodeKey(1, [2]));
assert(createNodeKey(1, [null]) != createNodeKey(1, [undefined]));
assert(createNodeKey(1, [undefined]) != createNodeKey(1, []));;
assert(createNodeKey(1, [undefined]) == createNodeKey(1, [undefined]));;


// Create root

let evts = 0;
const dirtyCB = () => { evts += 1000; };

{
    const f0 = () => { evts += 1; return 2; };
    const root = newRoot(f0, dirtyCB);
    eq(2, root.get());
    eq(evts, 1);
    eq(2, root.get());
    eq(evts, 1);
}


// memo & isolate
{
    const st1 = newState(0);
    const st2 = newState(0);
    evts = 0;
    const f1 = () => { evts += 1; return st1.get() & 1;};
    const f2 = () => { evts += 10; return st2.get() & 1; };
    const f3 = () => { evts += 100; return memo(f1)() + isolate(f2); };
    const root = newRoot(f3, dirtyCB);
    eq(0, root.get());
    eq(evts, 111);

    // ASSERT: change to input of an isolate() node dirties its parent
    st1.set(2);
    eq(evts, 1111);

    // ASSERT: no additional CB after root is already dirty
    st1.set(1);
    eq(evts, 1111);

    // ASSERT: change to input of memo(f1) node dirties its parent
    // ASSERT: non-memoized isolate(f2) node is re-created when parent re-evals
    evts = 0;
    eq(1, root.get());
    eq(evts, 111);

    // st2 change ==> re-eval f2 & f3.

    // ASSERT: change to input of an isolate() node dirties its parent
    // ASSERT: isolate(f2) is not memoized (f2 is re-evaluated once before
    //     f1 and again when f1 re-evals and creates a new isolate(f2) node.
    // ASSERT: memo(f1) is not re-evaluated.
    evts = 0;
    st2.set(1);
    eq(2, root.get());
    eq(evts, 1120);

    // change st1 but not f1 => dirty + re-eval only f1
    evts = 0;
    st1.set(3);
    eq(2, root.get());
    eq(evts, 1001);

    // no change => no dirty + no re-eval
    evts = 0;
    eq(2, root.get());
    eq(evts, 0);
}


// Exception handling: catch and remember sub-node's error
if (false) {
    const st1 = newState(() => 1);
    const st2 = newState(0);
    const f1 = () => {
        evts += 1;
        const f = st1.get();
        return f();
    }
    const main = () => {
        evts += 10;
        st2.get();
        try {
            return memo(f1)();
        } catch (e) {
            return e.name;
        }
    }

    evts = 0;
    const root = newRoot(main, dirtyCB);
    eq(1, root.get());
    eq(11, evts);

    evts = 0;
    st1.set(() => 1);
    eq(1, root.get());
    eq(1001, evts);   // invalidate + f1 node

    // Generate error with `null`
    evts = 0;
    st1.set(null);
    eq("TypeError", root.get());
    eq(1011, evts);

    // Invalidate main().  Cached exception should be re-thrown.
    evts = 0;
    st2.set(1);
    eq("TypeError", root.get());
    eq(1010, evts);

    root.drop();
}

// ASSERT: root node re-throws (regression)

let x = null;
try {
    x = inRoot(_ => { let f = null; f(1); return 1;});
} catch (e) {
    x = "Caught!";
}
eq("Caught!", x);


// deferMemo
{
    evts = 0;
    let x = deferMemo(_ => {evts += 1; return 7;})();

    eq(true, isThunk(x));
    eq(evts, 0);
    eq(x.get(), 7);
    eq(evts, 1);
}


// onDrop

let log = "";
const stD = newState("A");
const fD = () => {
    onDrop(() => {log += ">"});
    onDrop(() => {log += "<drop"});
    log += stD.get();
};
const rootD = newRoot(fD, () => {});

// ASSERT: on initial eval, fD is called but its onDrop is not
rootD.get();
eq("A", log);

// ASSERT: on re-eval, fD is called again *after* onDrops are called
// ASSERT: onDrops are processed LIFO
stD.set("B");
rootD.get();
eq("A<drop>B", log);

// ASSERT: when root is dropped, onDrop is called.
rootD.drop();
eq("A<drop>B<drop>", log);


// latch

{
    let s1 = newState(1);
    let f = () => {
        return latch(0, n => n + demand(s1));
    }
    const root = newRoot(f, () => {});
    eq(1, root.get());
    s1.set(2);
    eq(3, root.get());
}
