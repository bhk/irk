Alias(default).in = Alias(test)
Alias(test).in = TestJS@tests

tests = util_q.js i_q.js e_q.js grid_q.js grid_demo_q.js drag_demo_q.js

testFor = $(patsubst %,TestJS(%),$(filter $(patsubst %.js,%_q.js,$1),$(tests)))

# Enforce some ordering of tests...
TestJS.oo = TestJS(e_q.js)
TestJS(i_q.js).oo =
TestJS(e_q.js).oo = TestJS(i_q.js)


# TestJS(TEST) : Execute TEST Javascript file using node.
#
# We use `--experimental-loader` to track implied deps.
#
TestJS.inherit = Builder
TestJS.command = @{env} node {depsFlags} {<} && touch {@}
TestJS.env = NODE_NO_WARNINGS=1 TestJS_MT={@}
TestJS.depsFlags = --experimental-loader ./build/node-M.js
TestJS.rule = -include {@}.d$(\n){inherit}


# Demo(FILE): Shorthand for Open(JSToHTML(Bundle(FILE)))
#
Demo.inherit = Phony
Demo.in = Open(JSToHTML(Bundle($(_argText)_demo.js)))


# Open(FILE) : Launch a browser/viewer on FILE
#
Open.inherit = Phony
Open.command = open -a "Google Chrome" {<}


# Bundle(SOURCE,[min:1]) : Bundle JS module SOURCE with its dependencies.
#
# We use a rollup config file to track implied dependencies and optionally
# minify.
#
Bundle.inherit = Builder
Bundle.command = {env} rollup {<} -c {up<} --failAfterWarnings --file {@}
Bundle.env = $(if {min},MINIFY=1 )REMAP='test.js=no-test.js'
Bundle.rule = -include {@}.d$(\n){inherit}
Bundle.up = build/rollup.config.js
Bundle.min = $(call _namedArgs,min)
# Better to catch glaring bugs in node than in a browser...
Bundle.oo = $(call testFor,{<})


# JSToHTML(JS) : Create an HTML file that runs a JS module.
#
JSToHTML.inherit = Builder
JSToHTML.outExt = .html
JSToHTML.command = node {up<} {<} -o {@}
JSToHTML.up = build/js-to-html.js


JSMin.inherit = Builder
JSMin.command = terser --compress "ecma=2015,toplevel,unsafe_arrows" --mangle toplevel --define globalThis.TEST=false -o {@} {<}


include ../minion/minion.mk
