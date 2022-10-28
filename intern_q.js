import {intern} from "./intern.js";
import test from "./test.js";
const {assert, eq} = test;


//----------------------------------------------------------------
// tests
//----------------------------------------------------------------

const eqq = (a, b) => (a === b || eq(["A", a], ["B", b]));

const ti = (v) => {
    if (v instanceof Object) {
        // clone
        const vc = v instanceof Array ? [] : {};
        Object.assign(vc, v);

        const vi = intern(v);
        eq(vi, v);
        eqq(vi, intern(vc));
    } else {
        eqq(v, intern(v));
    }
};

ti(1);
ti("abc");
ti(true);
ti(null);
ti(undefined);

ti([]);
ti([1, 2, 3]);

ti({a: 1, b: 2, c: []});
