// initialize browser globals & minimal DOM API support

import "./mockdom.js";
import test from "./test.js";
import E from "./e.js";
import {newState, newRoot, defer, demand, inRoot} from  "./i.js";

const {eq, assert} = test;

// ASSERT: e.js creates a style sheet for its use

const sheet = document.styleSheets[0];
assert(sheet);


// E.cssName()

eq("float", E.cssName("float"));
eq("float", E.cssName("cssFloat"));
eq("-webkit-box-flex", E.cssName("boxFlex"));

eq("2px", E.cssValue(2));
eq("float -webkit-transform -moz-bar -ms-baz",
   E.cssValue("#{float} #{transform} #{MozBar} #{msBaz}"));


// E.derive

eq(true, inRoot(_ => {
    const Foo = E.derive("foo", {
        color: "black",
        transform: "#{transform} #{color}",

        "?:hover": {
            color: "blue"
        },

        "?.enabled": {
            color: "red"
        }
    });

    eq(".foo", Foo.selector);
    eq("", E.selector);
    // ASSERT: styling object stringizes as class names
    eq("foo", String(Foo));

    eq(sheet.cssRules.length, 3);
    eq(sheet.cssRules[0].selectorText, ".foo");
    eq(sheet.cssRules[1].selectorText, ".foo.enabled");
    eq(sheet.cssRules[2].selectorText, ".foo:hover");

    eq(sheet.cssRules[0].style.color, "black");
    eq(sheet.cssRules[1].style.color, "red");
    eq(sheet.cssRules[0].style["-webkit-transform"], "-webkit-transform color");

    // derive from derived class

    const Bar = Foo.derive({
        color: "blue",
    });
    eq(sheet.cssRules.length, 4);
    eq(".foo.C0", Bar.selector);


    let e;

    // E.new

    e = E.new();
    eq(e.tagName, "div");
    eq(e.className, "");
    eq(0, e.childNodes.length);

    e = E.new("i");
    eq(e.tagName, "i");
    eq(e.className, "");
    eq(0, e.childNodes.length);

    e = E.new({content: "x"});
    eq(e.tagName, "div");
    eq(e.className, "");
    eq(1, e.childNodes.length);


    // <DERIVED>.new,  `content`

    e = Foo.new("span", {
        content: ["abc", null, "def"],
    });
    eq(e.tagName, "span");
    eq(e.className, "foo");
    eq(2, e.childNodes.length);


    // E.new with content & tagName

    e = Foo.new("span", {
        class: "foo",
        content: ["abc", "def"],
    });
    eq(e.tagName, "span");
    eq(e.className, "foo");
    eq(2, e.childNodes.length);


    // E.new class = styling object

    e = E.new({
        class: Foo,
    });
    eq(e.className, "foo");


    // E.new with style=styleInfo

    e = E.new({
        style: {
            width: 2,
            color: "black",
        }
    });
    eq("2px", e.style.width);
    eq("black", e.style.color);

    return true;
}));

// ASSERT: resources are freed on drop
eq(sheet.cssRules.length, 0);


// E.derive with changeable values:
//    derive: style properties
//    new: style properties
//         content attribute
//         class attribute
//


const icolor = newState("black");
const ifont = newState("Arial");
const icontent = newState(["a"]);
const itag = newState("div");

const mainFn = () => {
    const CT = E.derive("CT", {
        color: icolor,
    });

    return CT.new(itag.get(), {
        style: {
            font: ifont,
        },
        content: icontent,
    });
}

let evts = 0;
const iroot = newRoot(mainFn, () => {evts += 1000;});

// Eval 1

const e0 = iroot.get();
eq(e0.tagName, "div");
eq(sheet.cssRules.length, 1);
eq(sheet.cssRules[0].selectorText, ".CT");
eq(sheet.cssRules[0].style.color, "black");
eq(e0.style.font, "Arial");
eq(e0.childNodes[0].textContent, "a");

// Eval 2 : change values handled within E

evts = 0;
icolor.set("red");
ifont.set("mono");
icontent.set(["b"]);
eq(evts, 1000);
const e1 = iroot.get();

// ASSERT: no re-creation of element or class
assert(e1 === e0);
eq(sheet.cssRules[0].selectorText, ".CT");
// ASSERT: class style has been updated
eq(sheet.cssRules[0].style.color, "red");
// ASSERT: element style has been updated
eq(e1.style.font, "mono");
// ASSERT: element content has been replaced
eq(e1.childNodes.length, 1);
eq(e1.childNodes[0].textContent, "b");

// Eval 3 : invalidate mainFn()

itag.set("span");
const e2 = iroot.get();
// ASSERT: new element
assert(e2 !== e0);
eq(e2.tagName, "span");
// ASSERT: no leakage of resources after re-eval
eq(sheet.cssRules[0].selectorText, ".CT");
eq(e1.childNodes.length, 1);

// Drop root

// ASSERT: no leakage of resources after drop
iroot.drop();
eq(sheet.cssRules.length, 0);


// eventStream

inRoot(_ => {
    const e = E.new({});
    const s = E.eventStream(e, ["a", "b", "c"]);
    eq("object", typeof demand(s));
});
