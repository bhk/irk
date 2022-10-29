// demo: Display a web page for demonstrating a JS module.
//

import {use, wrap, newState, defer} from "./i.js";
import {E, setContent} from "./e.js";

// Export for debugging
window.E = E;

// This element contains the element[s] under test.
//
const Frame = E.set({
    $name: "Frame",
    border: "2px solid #888",
    background: "#f0ede8",
    position: "relative",
    height: 350,
});

const Log = E.set({
    $name: "Log",
    margin: 8,
    paddingTop: 8,
    font: "14px Avenir, Arial, Helvetica",
    border: "0px solid #888",
    borderTopWidth: 1,
});

const Demo = E.set({
    $name: "Demo",
    position: "absolute",
    right: 0,
    left: 0,
    top: 0,
    bottom: 0,
    // Keep margins at zero to control all of background color
    padding: 20,
    background: "#ccc",
});

//
// Log
//
let logState = newState([]);
let log = (str) => logState.set([...use(logState), str]);
let LogLine = E.set({$tag: "p"});

// `style` applies to the frame containing the element under test.
// For example, size, background, and position (static or relative).
//
const demoView = ({subject, controls, frameStyle}) => {
    return Demo(null, [
        // frame
        Frame(frameStyle, subject),

        // controls
        E({
            $tag: "ul",
            font: "16px Avenir, Arial, Helvetica",
            margin: 6,
        }, (controls || []).map(c => E({$tag: "li"}, c))),

        // log
        Log(null, defer(_ => {
            return use(logState).map(e => LogLine(null, e));
        })),
    ]);
}

// Evaluate `main` and display its results in the demo context.
// The results of `main()` are passed to `demoView`.
//
const run = wrap((main) => {
    const opts = main();
    const top = demoView(opts);
    setContent(document.body, top);
});

export {
    run,
    log,
};
