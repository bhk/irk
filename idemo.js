import {newState, defer, activate} from "./i.js";
import E from "./e.js";


// Export for debugging
window.require = require;
window.E = E;


const newNote = (c) => E.new("li", { content: [c] });


// This element contains the element[s] under test.
//
const Frame = E.derive("Frame", {
    border: "1px solid #888",
    background: "#f0ede8",
    position: "relative",
    height: 200,
});


const Log = E.derive("Log", {
    margin: 8,
    paddingTop: 8,
    font: "14px Arial, Helvetica",
    border: "0px solid #888",
    borderTopWidth: 1,
});


oconst Demo = E.derive("Demo", {
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
const demoView = opts => {
    console.log("demoView!");
    let {subject, style, buttons, notes, log} = opts;
    style = style || {};

    return Demo.new({ content: [
        // buttons
        E.new({
            style: {margin: 6},
            content: buttons,
        }),

        // frame
        Frame.new({
            style: style,
            content: [subject],
        }),

        // notes
        E.new("ul", {
            style: {
                font: "12px Arial, Helvetica",
            },
            content: (notes || []).map(newNote),
        }),

        // log
        Log.new({
            content: log && defer(_ => log.get().forEach(e => E.new({content: e}))),
        }),

        // Time
        E.new("pre", {
            content: opts.subjectTime,
        }),
    ]});
}


// Evaluate `main` and display its results in the demo context.
// The results of `main()` are passed to `demoView`.
const run = (main) => {
    let log = newLog();
    activate(() => {
        const opts = main(log);
        const top = demoView(opts);
        E.setContent(document.body, [top]);
        // Display dependencies:
        //        for (let [c, result] of getCurrentNode().children) {
        //            console.log("D[" + String(c.f) + " -> " + result + "]");
        //        }
    });
};


module.exports = {
    run,
    demoView,
};
