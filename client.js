// ROP/WS client for the brower environment

import {use, activate, rootCause, Pending} from "./i.js";
import {E, setProps, setContent} from "./e.js";
import {Agent} from "./rop.js";

const activatePending = (fn) => activate(() => {
    try {
        fn();
    } catch (e) {
        let cause = rootCause(e);
        if (cause instanceof Pending) {
            console.log("Pending:", cause.value)
        }
    }
});

setProps(document.body, {
    margin: 20,
    font: "20px 'Avenir Next'",
});

//----------------------------------------------------------------

let ws = new WebSocket("ws://localhost:8002/rop");
let agent = new Agent(ws);

let main = () => {
    let f = agent.getRemote(0);
    setContent(document.body, [ f() ]);
};

activatePending(main);
