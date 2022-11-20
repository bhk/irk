import {
    defer, use, newState, wrap, onDrop, stream
} from "./i.js";
import {E, setProps} from "./e.js";
import {run, log} from "./demo.js";

const {newStream, fold} = stream;
const mostRecent = fold((r,e) => e);

//----------------------------------------------------------------
// eventStream & dragStream
//----------------------------------------------------------------

// eventNames = array of event names (aka "types")
//
const eventStream = function (e, eventNames) {
    const stream = newStream();
    const $events = {};
    for (const name of eventNames) {
        $events[name] = stream.emit;
    }
    setProps(e, {$events});
    return stream;
};

// Return `factory` where factory(elem) returns a drag stream for elem.
// This function is wrapped so that we will have only one factory, and one
// set of event listeners (whose lifetime is controlled by cell liveness).
//
const getDragStreamFactory = wrap(() => {
    const m = new Map();  // elem -> {stream, refs}
    let activeStream = null;
    let eventDown;

    const docListener = (event) => {
        if (event.type == "mousedown") {
            const rec = m.get(event.target);
            if (rec) {
                activeStream = rec.stream;
                eventDown = event;
            }
        }

        if (activeStream != null) {
            activeStream.emit({
                type: (event.type == "mousedown" ? "down" :
                       event.type == "mousemove" ? "move" : "up"),
                dx: event.pageX - eventDown.pageX,
                dy: event.pageY - eventDown.pageY,
                isIn: event.target === eventDown.target,
                event: event,
            });

            if (event.type == "mouseup") {
                activeStream = null;
            }
        }
    };

    setProps(document, {
        $events: {
            mousedown: docListener,
            mouseup: docListener,
            mousemove: docListener,
        }
    });

    const factory = (elem) => {
        // Create/get drag stream for elem
        let rec = m.get(elem);
        if (rec == undefined) {
            rec = {stream: newStream(), refs: 1};
            m.set(elem, rec);
        } else {
            rec.refs += 1;
        }

        onDrop(_ => {
            rec.refs -= 1;
            if (rec.refs == 0) {
                m.delete(elem);
            }
        });
        return rec.stream;
    };

    return factory;
});

// Deliver drag events for `elem` (see e.txt).
//
const dragStream = (elem) => {
    const factory = getDragStreamFactory();
    return factory(elem);
};

//----------------------------------------------------------------
// demo
//----------------------------------------------------------------

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

const Box = E.set({
    $tag: "span",
    border: "10px solid gray",
    borderRadius: 4,
    background: "white",
    padding: "2px 4px",
    font: "14px monospace",
    userSelect: "none",
});

const Status = E.set({
    font: "12px Arial",
    border: "1px solid gray",
    borderRadius: 1,
    background: "#eee",
    padding: 2,
    userSelect: "none",
});

// style for the frame that contains `subject`
const frameStyle = {
    font: "26px Helvetica, Arial",
    padding: 15,
    height: 100,
};

run(_ => {
    // A: the drag stream target

    const a = Box(null, "A");
    const aEvent = mostRecent(dragStream(a));
    const aStatus = Status(null, defer(_ => serialize(use(aEvent))));

    // B: move event target (partially overlaps A)

    const b = Box({
        position: "relative",
        left: -10,
        top: -5,
        border: "10px solid rgba(204,187,170,0.5)",
        background: "transparent",
    }, "B");
    const bEvent = mostRecent(eventStream(b, ["mousemove"]));
    const bStatus = Status(null, defer(_ => serializeEvent(use(bEvent))));

    const subject = E(null, "- ", a, E({$tag: "br"}), b);

    const controls = [
        E(null, ["most recent dragStream(A): ", aStatus]),
        E(null, ["most recent eventStream(B, ['mousemove']): ", bStatus]),

        "B is relatively-positioned 10px to the left of its 'static' " +
            "position.  In Chrome & Safari, events that fall inside A and " +
            "the static position of B are delivered to neither A nor B.  " +
            "In Firefox, A gets the events.",
    ];

    return {subject, frameStyle, controls};
});
