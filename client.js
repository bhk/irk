// ORCA/WS client for the brower environment

import {E, setProps, setContent} from "./e.js";
import {activate, newState, defer} from "./i.js";
import {Agent} from "./rop.js";

//----------------------------------------------------------------
// Main
//----------------------------------------------------------------

let ws = new WebSocket("ws://localhost:8002/orca");
let agent = new Agent(ws);
let m1 = agent.getRemote(1);
let r = m1("arg1");

let resultToString = r => {
    console.log(`RTS: ${r}`);
    return (r.isPending() ? "Pending..." :
            r.isError() ? `Error: ${agent.getError()}` :
            String(r.getValue()));
}

let main = () => {

    let box = E.set({
        $tag: "span",
        border: "1px solid #666",
        background: "#eee",
        padding: 4,
    });

    setProps(document.body, {
        margin: 20,
        font: "20px 'Avenir Next'",
    });
    setContent(document.body, [
        box(null, [defer(_ => resultToString(r))]),
    ]);
};

activate(main);
