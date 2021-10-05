// E: dynamic element styling (See e.txt)

// New API (utilities):
//   E.cssName(s)
//   E.cssValue(s)
//   E.css => CSSStyle
//      CSSStyle.derive()
//      CSSStyle.new(attrs)
//
// Possible directions:
//  - Allow lazy `attrInfo` objects (not just prop values).
//    A change would require re-setting all properties.
//  - Allow content array to contain (maybe lazy) arrays, and flatten.
//    Top arg must be an array (to distinguish it from attrs & tagName).

import {memo, isThunk, isolate, onDrop, demand, newStream} from "./i.js";

const D = document;

//------------------------------------------------------------------------
// Normalize CSS property names
//------------------------------------------------------------------------


function throwError(arg) {
    throw Error(arg);
}


// Memoize a function that accepts a single string argument
//
function memoize(fn) {
    const cache = new Map();
    return (arg) => {
        if (cache.has(arg)) {
            return cache.get(arg);
        }
        const result = fn(arg);
        cache.set(arg, result);
        return result;
    }
}


// Create style object for detecting browser-specific prefixing
//
const styleObject = D.createElement("div").style;


const prefixes = [ null, "webkit", "Moz", "ms", "css" ];


// Convert a generic JavaScript style property name (camel case) to the
// browser-specific variant (camel case) for the curret browser.
//
// E.g.  "boxSizing" -> "MozBoxSizing"   [on some browers]
//
const normalizeName = (name) => {
    for (const prefix of prefixes) {
        const prop = (prefix
                      ? prefix + name[0].toUpperCase() + name.substr(1)
                      : name);
        // Yes, the "in" operator includes properties like "toString", but
        // presumably actual property will have to avoid these conflicts.
        if (prop in styleObject) {
            return prop;
        }
    }
    return name;
};


// Convert a generic JavaScript style property name (camel case) to a CSS
// property name recognized by the current browser.  The resulting form is
// what needs to appear within CSS property values (like `transition`).
//
// E.g.  "boxSizing" -> "-moz-box-sizing"   [on some browser]
//
let cssName = (name) => {
    return normalizeName(name)
        .replace(/^cssFloat$/, "float")
        .replace(/([A-Z])/g, "-$1").toLowerCase()
        .replace(/^(webkit|ms)/, "-$1");
}


cssName = memoize(cssName);


// Convert JavaScript values to strings suitable for CSS.  Converts numbers
// to dimensionts in "px" units.  Within strings, replace "#{NAME}" with
// cssName("NAME").
//
const cssValue = (value) => {
    if (typeof value == "string") {
        return value.replace(/#\{(.*?)\}/g, (_, name) => cssName(name));
    } else if (typeof value == "number") {
        return value + "px";
    } else {
        return "";
    }
}


//------------------------------------------------------------------------
// Construct non-conflicting class names
//------------------------------------------------------------------------

const allNames = new Set();

// Return a name different from all previous results
//
const getUniqueName = (name) => {
    while (allNames.has(name)) {
        // append or increment number
        const m = name.match(/(.*?)(\d*)$/);
        name = m[1] + (+m[2] + 1);
    }
    allNames.add(name);
    return name;
}


const releaseUniqueName = (name) => {
    allNames.delete(name);
}


//------------------------------------------------------------------------
// Dynamic style sheet manipulation
//------------------------------------------------------------------------

// Add a new stylesheet to hold our generated CSS rules
D.head.appendChild(D.createElement("style"));
const styleSheet = D.styleSheets[D.styleSheets.length - 1];


// Dynamically create an empty style sheet rule, and return the style
// object.
//
const insertRule = (selector) => {
    styleSheet.insertRule(selector + " {}", 0);
    return styleSheet.cssRules[0];
}


// Remove rules matching selectors.
//
const deleteRules = (selectorSet) => {
    let rule;
    for (let i = 0; (rule = styleSheet.cssRules[i]) != null; ++i) {
        if (selectorSet.has(rule.selectorText)) {
            styleSheet.deleteRule(i);
            --i;
        }
    }
}


// Assign an individual property to a style object.
//
const setStyleProperty = (style, name, value) => {
    if (isThunk(value)) {
        return isolate(_ => setStyleProperty(style, name, value.get()));
    }
    name = cssName(name);
    style[name] = (value == null ? "" : cssValue(value));
}


// Assign properties in `info` to style object `style`
//
const setStyleProperties = (style, info) => {
    Object.keys(info).sort().forEach(
        name => setStyleProperty(style, name, info[name])
    );
}


// Replace "?" wildcard in pattern with `baseSelector`
//
const expandSelector = (baseSelector, pattern) => {
    return pattern.replace(/\?/g, baseSelector);
}


// Convert a styleInfo structure (potentially with nested selector patterns)
// to a flat array of {selector, info} records.
//
const flattenStyleInfo = (selector, styleInfo) => {
    let rules = [];
    const info = {};
    for (const name in styleInfo) {
        const value = styleInfo[name];
        if (/\?/.test(name)) {
            // selector pattern
            rules = rules.concat(
                flattenStyleInfo(expandSelector(selector, name), value));
        } else {
            // CSS property
            info[name] = value;
        }
    }
    rules.sort().push({selector, info});
    return rules;
};


//------------------------------------------------------------------------
// E
//------------------------------------------------------------------------


const E = {
    selector: "",
    toString: function () {
        return this.selector.replace(/\./g, " ").substr(1);
    },
    cssName: cssName,
    cssValue: cssValue,
};


E.derive = function (...args) {
    const [name, props] = (args.length == 2
                         ? args
                         : ["C0", args[0]]);

    const me = Object.create(this);
    const className = getUniqueName(name);
    me.selector = this.selector + "." + className;

    // Create stylesheet rules
    const rules = flattenStyleInfo(me.selector, props);
    const selectorSet = new Set();
    for (const {selector, info} of rules) {
        selectorSet.add(selector);
        const style = insertRule(selector).style;
        setStyleProperties(style, info);
    }

    // Clean up allocated resources when no longer needed
    onDrop(_ => {
        releaseUniqueName(className);
        deleteRules(selectorSet);
    });

    return me;
}


const setListener = (elem, name, fn) => {
    elem.addEventListener(name, fn);
    onDrop(_ => elem.removeEventListener(name, fn));
}


E.setListeners = (e, o) => {
    for (const [name, f] of Object.entries(o)) {
        setListener(e, name, f);
    }
}


// Set attribute `name` to `value`.  Do not assume values have not already
// been set on the element; this can be re-evaluted in an isolated function.
//
E.setAttr = (e, name, value) => {
    if (isThunk(value)) {
        return isolate(_ => E.setAttr(e, name, value.get()));
    }

    if (name == "style" && typeof value == "object") {
        // Set style properties individually, but first reset all of them
        // so that on re-evaluation leftovers do not persist.
        e.style.cssText = "";
        setStyleProperties(e.style, value);
    } else if (name == "listeners") {
        E.setListeners(e, value);
    } else if (typeof value == "function") {
        throw Error("bad attribute");
    } else {
        e.setAttribute(name, String(value));
    }
}


// Log invalid child nodes in this global for debugging.
//
const BADNODE = [];
window.BADNODE = BADNODE;


const badNodeText = (value) => {
    const text = "<BADNODE[" + BADNODE.length + "]>";
    BADNODE.push(value);
    return D.createTextNode(text);
}


const prepareNode = (node) =>
      (node instanceof Node
       ? node
       : D.createTextNode(typeof node == "string" ? node :
                          node == null ? "" :
                          badNodeText(node)));


// Insert a time-changing child value.  After a change, the previously
// inserted node will be replaced with the new value.
//
const insertNode = (parent, value) => {
    let prevNode = null;
    isolate(_ => {
        let node = prepareNode(demand(value));
        if (prevNode == null) {
            parent.appendChild(node);
        } else {
            parent.replaceChild(node, prevNode);
        }
        prevNode = node;
    });
};


// Replace content of element `e` with `content` (a string, DOM element, or
// array of strings/elements).
//
E.setContent = (e, content) => {
    if (isThunk(content)) {
        return isolate(_ => E.setContent(e, content.get()));
    }

    // Remove existing content
    while (e.firstChild) {
        e.removeChild(e.firstChild);
    }

    if (!(content instanceof Array)) {
        content = [content];
    }
    for (let child of content) {
        // Allow "holes" in the content array
        if (child != null && child !== "") {
            if (isThunk(child)) {
                insertNode(e, child);
            } else {
                e.appendChild(prepareNode(child));
            }
        }
    }
}


E.setAttrs = function(e, attrs) {
    Object.keys(attrs).forEach(key => {
        if (key == "content") {
            E.setContent(e, attrs[key]);
        } else {
            E.setAttr(e, key, attrs[key]);
        }
    });

    if (attrs.class === undefined) {
        E.setAttr(e, "class", this);
    }
};


// Create and return a new element.
//
E.new = function (...args) {
    const tagName = typeof args[0] == "string" ? args.shift() : "div";
    const attrs = args[0] || {};

    const e = D.createElement(tagName);
    this.setAttrs(e, attrs);
    return e;
}


// eventNames = array of event names (aka "types")
//
E.eventStream = function (e, eventNames) {
    const stream = newStream();
    for (const name of eventNames) {
        setListener(e, name, stream.append);
    }
    return stream;
};


// Return `factory` where factory(elem) returns a drag stream for elem.
// This function should be memoized so that only one set of event listeners
// will need to be added to `document` no matter how many elements have drag
// streams.
//
const getDragStreamFactory = () => {
    const m = new Map();  // elem -> {stream, refs}
    let activeStream = null;
    let eventDown;

    const listener = (event) => {
        if (event.type == "mousedown") {
            const rec = m.get(event.target);
            if (rec) {
                activeStream = rec.stream;
                eventDown = event;
            }
        }

        if (activeStream != null) {
            activeStream.append({
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

    for (const name of ["mousedown", "mouseup", "mousemove"]) {
        setListener(document, name, listener);
    }

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
            rec.refs -= 1
            if (rec.refs == 0) {
                m.delete(elem);
            }
        });
        return rec.stream;
    };

    return factory;
}


// Deliver drag events for `elem` (see e.txt).
//
E.dragStream = (elem) => {
    const factory = memo(getDragStreamFactory)();
    return factory(elem);
};


export default E;
