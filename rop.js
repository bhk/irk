// rop.js: Remote Observation Protocol over WebSockets
//
// Agent is a ROP agent that uses the WebSocket API to communicate with its
// peer.  On the client side, an Agent will be constructed after connecting
// to a server.  On the server side, an Agent will be constructed after
// accepting a connection.
//
// [1] https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
// [2] https://github.com/websockets/ws/blob/master/doc/ws.md
//
// API
//
// agent = new Agent(websocket, initialFuncs)
//     Create a new agent to talk to a "peer" agent at the other end
//     of the `websocket`.
//
// f = agent.getRemote(NUM)
// result = f(...args...)
//
//     Call one of the peer agent's initial functions.  This must be done
//     within a cell.  Immediately, `result` will be a Pending error, but
//     later will transition to the actual result (or error state).
//
//     `f` is a wrapped function; when called it creates or reuses a cell.
//
//     `args` other than functions will be serialized.  Functions, however,
//     are sent as capabilities.  The other side will receive a function
//     that can be used to invoke the function.  If the function being
//     passed is already remoted from the peer, it will be unwrapped, so the
//     peer will receive the original peer-side function value that was
//     remoted to our side.
//

import {
    use, onDrop, wrap, activate, Pending, usePending,
    newState, newCell, getCurrentCell, valueText,
} from "./i.js";

// Protect against pollution of global namespace.  This module should work
// in Node (without MockDom.js) where WebSocket is not a global.
let WebSocket = null;

let assert = (cond, desc) => {
    if (!cond) {
        throw new Error(desc || "FAILED");
    }
    return cond;
};

//--------------------------------
// Pool
//--------------------------------

class Pool extends Array {
    constructor() {
        super();
        this.nextEmpty = null;
        this.countUsed = 0;
    }

    alloc() {
        ++this.countUsed;
        let ndx = this.length;
        if (this.nextEmpty != null) {
            ndx = this.nextEmpty;
            this.nextEmpty = this[ndx];
            this[ndx] = null;
        }
        return ndx;
    }

    free(ndx) {
        --this.countUsed;
        this[ndx] = this.nextEmpty;
        this.nextEmpty = ndx;
    }

    add(value) {
        let ndx = this.alloc();
        onDrop(() => {
            this.free(ndx);
        });
        this[ndx] = value;
        return ndx;
    }
}

// Avoid WebSocket global (browser-only)
const wsCONNECTING = 0;
const wsOPEN = 1;
const wsCLOSING = 2;
const wsCLOSED = 3;

//----------------------------------------------------------------
// Agent
//----------------------------------------------------------------

const ropOPEN = "Open";             // slot oid values...
const ropUPDATE = "Update";         // slot value     [response]
const ropCLOSE = "Close";           // slot
const ropACKCLOSE = "AckClose";     // slot           [response]
const ropACKUPDATE = "AckUpdate";   // slot

let countRemotes = 0;

class Agent {
    // slot state changes:
    //   a) closed -> open:  send Open
    //   b) receive Update:  modify state; send Ack
    //   c) onDrop:          send Close

    constructor(ws, initialFuncs) {
        this.slotsOut = new Pool();
        this.slotsIn = [];
        this.caps = new Pool();
        for (let f of initialFuncs || []) {
            this.caps[this.caps.alloc()] = f;
        }

        this.ws = ws;
        this.sendQueue = [];

        // We must re-use forwarders and observations, or else callers will
        // continually recalc, getting a new observation each time.  We can
        // wrap these at construction time, since these lifetime of the
        // wrapped forms exceeds the time when they can be called.
        this.observe = wrap(this.observe_.bind(this)).cell;
        // getRemote() returns an ordinary value; there is no PENDING/ERROR
        // state involved to no reason to return a cell.
        this.getRemote = wrap(this.getRemote_.bind(this));

        ws.onopen = (evt) => {
            // this.log(`onopen`);
            for (let msg of this.sendQueue) {
                // this.log(`send ${msg}`);
                this.ws.send(msg);
            }
            this.sendQueue = [];
        };

        ws.onerror = (evt) => console.log("Agent: error", evt);

        // onmessage: MessageEvent -> void
        ws.onmessage = (evt) => {
            if (this.log) {
                this.log(`recv ${evt.data}`);
            }
            let [type, slot, ...args] = JSON.parse(evt.data);
            (type == ropOPEN      ? this.onOpen(slot, ...args) :
             type == ropUPDATE    ? this.onUpdate(slot, ...args) :
             type == ropACKUPDATE ? this.onAckUpdate(slot) :
             type == ropCLOSE     ? this.onClose(slot) :
             type == ropACKCLOSE  ? this.onAckClose(slot) :
             assert(false, `Unknown message type ${type}`));
        };
    }

    onOpen(slot, oid, ...wireArgs) {
        let args = wireArgs.map(value => this.decode(value));
        let fn = this.caps[oid];
        assert(typeof fn == "function");
        assert(this.slotsIn[slot] == null);
        let callCell = newCell(_ => use(fn(...args)));
        callCell.id = "updCall";
        let updCell = activate(() => {
            let [done, result] = usePending(callCell);
            result = done ? result : "PENDING:" + result;
            this.send(ropUPDATE, slot, this.encode(result));
        });
        updCell.name = "inbound";
        this.slotsIn[slot] = updCell;
    }

    onClose(slot) {
        let cell = this.slotsIn[slot];
        cell.deactivate();
        this.slotsIn[slot] = null;
        this.send(ropACKCLOSE, slot);
    }

    onUpdate(slot, value) {
        let r = this.slotsOut[slot];
        value = this.decode(value);
        if (r instanceof Object) {
            // this.log(`r[${slot}] = ${value}`);
            r.set(value);
        } else {
            console.log(`Agent: bogus slot ${slot}`);
        }
        this.send(ropACKUPDATE, slot);
    }

    onAckUpdate(slot) {
    }

    onAckClose(slot) {
        assert(this.slotsOut[slot] == "ZOMBIE");
        this.slotsOut.free(slot);
    }

    send(type, slot, ...args) {
        let msg = JSON.stringify([type, slot, ...args]);
        if (this.ws.readyState == wsOPEN) {
            // this.log(`send ${msg}`);
            this.ws.send(msg);
        } else if (this.ws.readyState == wsCONNECTING) {
            if (this.log) {
                this.log(`post ${msg}`);
            }
            this.sendQueue.push(msg);
        } else {
            console.log(`Agent: bad state ${this.ws.readyState}`);
        }
    }

    toOID(fn) {
        return (fn.$OID == null
                ? -1 - this.caps.add(fn)      // local  (negative => sender)
                : fn.$OID);                   // remote (non-neg => recipient)
    }

    fromOID(oid) {
        return (oid < 0
                ? this.getRemote(-1 - oid)    // remote (negative => sender)
                : assert(this.caps[oid]));    // local  (non-neg => recipient)
    }

    encode(v) {
        return (v instanceof Array ? [v.map(x => this.encode(x))] :
                typeof(v) == "function" ? [this.toOID(v)] :
                v);
    }

    decode(v) {
        return (!(v instanceof Array) ? v :
                typeof v[0] == "number" ? this.fromOID(v[0]) :
                v[0].map(x => this.decode(x)));
    }

    // Begin a new observation
    observe_(oid, ...args) {
        // this.log("open ..");
        let slot = this.slotsOut.alloc();

        getCurrentCell().id = `R${oid}(${slot})`;  // debugging

        let r = newState();
        r.setError(new Pending("opening"));
        this.slotsOut[slot] = r;

        // package args
        // let xargs = this.encodeArgs(args);

        let wireArgs = args.map(value => this.encode(value));
        this.send(ropOPEN, slot, oid, ...wireArgs);

        onDrop(() => {
            this.slotsOut[slot] = "ZOMBIE";
            this.send(ropCLOSE, slot);
        });
        return r;
    };

    getRemote_(oid) {
        // Remote functions are per (agent, oid, args)
        // (...args) -> cell
        let fwdr = (...args) => {
            // this.log && this.log(`evoke _o(${oid},${args.map(valueText)})`);
            //  & this.observe(oid, ...args)
            return this.observe(oid, ...args);
        };
        fwdr.$OID = oid;
        return fwdr;
    }
}

export {
    Agent,
    Pool,
}
