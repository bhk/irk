"use strict";

const I = require("incremental.js");
const E = require("e.js");
const IDemo = require("idemo.js");

const {
    defer, demand, mostRecent,
} = I;


const serialize = (o) => {
    if (o !== null && typeof o == "object") {
        const a = [];
        for (const key in o) {
            // don't recurse until we avoid loops
            a.push(key + ":" + String(o[key]));
        }
        return "{" + a.join(", ") + "}";
    } else if (typeof o == "string") {
        return '"' + o + '"';
    } else {
        return String(o);
    }
};


// Discard most fields of events for readability
//
const serializeEvent = (event) => {
    if (event != undefined) {
        const fields = ["type", "pageX", "pageY", "clientX", "clientY", "timeStamp"];
        const o = {};
        for (const name of fields) {
            o[name] = event[name];
        }
        event = o;
    }
    return serialize(event);
};


const Box = E.derive({
    border: "10px solid gray",
    borderRadius: 4,
    background: "white",
    padding: "2px 4px",
    font: "14px monospace",
    userSelect: "none",
});


const Status = E.derive({
    border: "1px solid gray",
    borderRadius: 4,
    background: "#eee",
    padding: "2px 4px",
    userSelect: "none",
});


const buttons = [
];


// style for the frame that contains `subject`
const style = {
    font: "12px Helvetica, Arial",
    padding: 15,
    height: 150,
};


const notes = [
    "A = most recent dragStream(A)",
    "B = most recent eventStream(A, ['mousemove'])",

    "B is relatively-positioned 10px to the left of its 'static' " +
        "position.  In Chrome & Safari, events that fall inside A and " +
        "the static position of B are delivered to neither A nor B.  " +
        "In Firefox, A gets the events.",
];


IDemo.run((log) => {
    // A: the drag stream target

    const a = Box.new("span", {content: ["A"]});
    const aEvent = mostRecent(E.dragStream(a));
    const aStatus = Status.new("span", {
        content: [defer(_ => serialize(demand(aEvent)))],
    });

    // B: move event target (partially overlaps A)

    const b = Box.new("span", {
        content: ["B"],
        style: {
            position: "relative",
            left: -10,
            top: -5,
            border: "10px solid rgba(204,187,170,0.5)",
            background: "transparent",
        },
    });
    const bEvent = mostRecent(E.eventStream(b, ["mousemove"]));
    const bStatus = Status.new("span", {
        content: [ defer(_ => serializeEvent(demand(bEvent))) ],
    });

    const subject = E.new("div", {
        style: {
            whiteSpace: "nowrap",
            lineHeight: 30,
        },
        content: [
            "- ", a,
            E.new("br"),
            b,
            E.new("br"),
            "A:", aStatus,
            E.new("br"),
            "B:", bStatus,
        ],
    });

    return {subject, buttons, style, notes, log};
});
