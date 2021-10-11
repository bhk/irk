import {newState, defer, activate} from "./i.js";
import {E, setContent} from "./e.js";

// Export for debugging
window.E = E;


// This element contains the element[s] under test.
//
const Frame = E.set({
    $name: "Frame",
    border: "1px solid #888",
    background: "#f0ede8",
    position: "relative",
    height: 200,
});

const Log = E.set({
    $name: "Log",
    margin: 8,
    paddingTop: 8,
    font: "14px Arial, Helvetica",
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

const newLog = () => {
    const a = newState([]);
    return {
        append: (str) => a.set(a.get().concat([str])),
        get: a.get.bind(a),
    };
}


// `style` applies to the frame containing the element under test.
// For example, size, background, and position (static or relative).
//
const demoView = ({subject, style, buttons, notes, log, subjectTime}) => {
    console.log("demoView!");

    return Demo(null, [
        // buttons
        E({margin: 6}, buttons),

        // frame
        Frame(style, subject),

        // notes
        E({
            $tag: "ul",
            font: "12px Arial, Helvetica",
        }, (notes || []).map(note => E({$tag: "li"}, note))),

        // log
        Log(null, log && defer(_ => log.get().forEach(e => E(null, e)))),

        // Time
        E({$tag: "pre"}, subjectTime),
    ]);
}


// Evaluate `main` and display its results in the demo context.
// The results of `main()` are passed to `demoView`.
const run = (main) => {
    let log = newLog();
    activate(() => {
        const opts = main(log);
        const top = demoView(opts);
        setContent(document.body, [top]);
        // Display dependencies:
        //        for (let [c, result] of getCurrentNode().children) {
        //            console.log("D[" + String(c.f) + " -> " + result + "]");
        //        }
    });
};


export {
    run,
    demoView,
};
