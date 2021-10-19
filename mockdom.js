// A minimal set of mock DOM APIs for testing.
//
// window
// document :: Node
// document.head
// document.body
// document.createElement
// document.createTextNode
// document.styleSheets
// <Node>.childNodes
// <Node>.appendChild
// <Node>.removeChild
// <Node>.textContent
// <Node>.addEventListener
// <Node>.removeEventListener
// <StyleSheet>.addRule
// <StyleRule>.selectorText
// <StyleRule>.style
// <Style>.<propertyName>

import test from "./test.js";
import assert from "assert";

//--------------------------------
// CSS classes
//--------------------------------
//
// See http://www.w3.org/TR/cssom/#the-stylesheet-interface
//

// JavaScript naming of style object property names; include some prefixed names.
let sampleProperties = "color font textAlign float textAlign " +
    "webkitBoxFlex webkitTransform MozFrob msMunge";

class CSSStyleDeclaration extends Array {
    constructor() {
        super();
        // populate with some camel-cased attributes
        for (let name of sampleProperties.split(" ")) {
            this[name] = "";
        }
    }
}

// this includes CSSRule
class CSSStyleRule  {
    constructor(selector, ruleText) {
        assert(ruleText == "");  // that's all we support for now

        // CSSRule
        this.STYLE_RULE = 1;
        this.type = this.STYLE_RULE;
        // Unimpl: cssText, parentRule, parentStyleSheet, various contants

        // CSSStyleRule
        this.selectorText = selector;
        this.style = new CSSStyleDeclaration();
    }
}

class CSSRuleList extends Array { }

class StyleSheet {
    constructor() {
        this.type = "text/css";
        this.href = null;
        this.title = null;
        this.disabled = false;
        // Others: mediaList, ownerNode, parentStyleSheet
    }
}

class CSSStyleSheet extends StyleSheet {
    constructor() {
        super();
        this.cssRules = new CSSRuleList();
        // Others: ownerRule
    }

    insertRule(rule, index) {
        assert(index >= 0 && index <= this.cssRules.length);
        const m = rule.match(/ *(.*?) *\{ *(.*?) *\}/);
        this.cssRules.splice(index, 0, new CSSStyleRule(m[1], m[2]));
        return index;
    }

    deleteRule(index) {
        this.cssRules.splice(index, 1);
    }
}

//--------------------------------
// Node
//--------------------------------

class Node {

    constructor() {
        this._childNodes = [];
        this._listeners = [];
        this._text = "";
    }

    get firstChild() {
        return this._childNodes[0];
    }

    _walk(visit) {
        for (let child of this._childNodes) {
            visit(child);
            if (child instanceof Node) {
                child._walk(visit);
            }
        }
    }

    removeChild(child) {
        const index = this._childNodes.indexOf(child);
        assert(index >= 0);
        this._childNodes.splice(index, 1);
        child.parentNode = null;
    }

    appendChild(child) {
        if (child.parentNode) {
            child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this._childNodes.push(child);

        return child;
    }

    addEventListener(name, fn, capture) {
        this._listeners.push([name, fn, capture]);
    }

    removeEventListener(name, fn, capture) {
        for (const index in this._listeners) {
            const el = this._listeners[index];
            if (el[0] === name && el[1] === fn && el[2] === capture) {
                this._listeners.splice(index, 1);
                return;
            }
        }
    }

    get textContent() {
        return this._childNodes.map(node => node.textContent).join("");
    }

    set textContent(text) {
        // support use case of removing all child nodes
        //TODO: assert(text === "");
        this._childNodes.splice(0, this._childNodes.length);
        this._text = text;
    }

    get childNodes() {
        return this._childNodes;
    }
}

//--------------------------------
// Element
//--------------------------------

class Element extends Node {
    constructor(tagName, ns) {
        super();
        tagName = tagName.toLowerCase();
        this.tagName = tagName;
        this._ns = ns;
        this._attrs = new Map();
        this._style = new CSSStyleDeclaration();
    }

    setAttribute(key, value) {
        assert(typeof key == "string");
        assert(typeof value == "string");
        this._attrs.set(key, value);
    }

    getAttribute(key) {
        assert(typeof key == "string");
        return this._attrs.get(key) || "";
    }

    set className(value) {
        this._attrs.set("class", value);
    }

    get className() {
        return this.getAttribute("class");
    }

    set id(id) {
        this._attrs.set("id", id);
    }

    get id() {
        return this._attrs.get("id") || "";
    }

    set style(value) {
        if (value != "") {
            throw new Error("mockdom: cannot parse STYLE attribute");
        }
    }

    get style() {
        return this._style;
    }
}

//--------------------------------
// StyleElement
//--------------------------------

class HTMLStyleElement extends Element {
    constructor() {
        super("style");
        this._styleSheet = new CSSStyleSheet();
    }
}

//--------------------------------
// Text
//--------------------------------

class Text extends Node {
    constructor(text) {
        super();
        this._textContent = String(text);
    }

    get textContent() {
        return this._textContent;
    }

    set textContent(text) {
        this._textContent = text;
    }
}

//--------------------------------
// Document
//--------------------------------

class Document extends Node {
    constructor() {
        super();
        const html = new Element("html");
        this.head = html.appendChild(new Element("head"));
        this.body = html.appendChild(new Element("body"));
        this.appendChild(html);
    }

    createElement(tagName) {
        if (tagName == "style") {
            return new HTMLStyleElement();
        }
        return new Element(tagName);
    }

    createElementNS(ns, tagName) {
        if (tagName == "style") {
            return new HTMLStyleElement();
        }
        return new Element(tagName, ns);
    }

    createTextNode(str) {
        return new Text(str);
    }

    // Create a new getter for the property
    get styleSheets() {
        let sheets = [];
        this._walk(node => {
            if (node instanceof HTMLStyleElement) {
                sheets.push(node._styleSheet);
            }
        });
        return sheets;
    }
}

//--------------------------------
// Browser Globals
//--------------------------------

let G = global;

G.window = global;
G.document = new Document();

// so "instanceof" will work...
G.Node = Node;
G.Element = Element;

//--------------------------------
// quick self-test
//--------------------------------

if (test) {
    let {eq} = test;

    const d = new Document();
    const styleElem = d.createElement("style");
    d.head.appendChild(styleElem);
    const sheet = d.styleSheets[d.styleSheets.length - 1];

    assert(sheet.cssRules instanceof Array);

    eq(0, sheet.insertRule("p {}", 0));
    const r = sheet.cssRules[0];

    eq(r.selectorText, "p");
}
