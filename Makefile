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


# Demo(NAME): Shorthand that builds JSToHTML(Bundle(NAME_demo.js))
# ODemo(NAME): Shorthand for Open(JSToHTML(Bundle(NAME_demo.js)))
#
Demo.inherit = Phony
Demo.in = JSToHTML(Bundle($(_arg1)_demo.js))
ODemo.inherit = Demo
ODemo.in = Open({inherit})


# Open(FILE) : Launch a browser/viewer on FILE
#
Open.inherit = Phony
Open.command = open -a "Google Chrome" {<}


# Bundle(SOURCE,[min:1]) : Bundle JavaScript SOURCE with its dependencies.
#
Bundle.inherit = ESBuild


# ESBuild(SOURCE,[min:1]) : Bundle with esbuild.
#
ESBuild.inherit = Builder
ESBuild.min = $(call _namedArgs,min)
ESBuild.command = {bundleCmd}$(\n){depsCmd}
ESBuild.bundleCmd = ./node_modules/.bin/esbuild --outfile={@} {<} --bundle $(if {min},--minify) --metafile={@}.json --color=false --log-level=warning
ESBuild.depsCmd = @node -p '(([k,v])=>k+": "+Object.keys(v.inputs).join(" "))(Object.entries(require("./{@}.json").outputs)[0])' > {depsFile}
ESBuild.rule = -include {depsFile}$(\n){inherit}
ESBuild.depsFile = {@}.d
ESBuild.vvValue = $(call _vvEnc,{bundleCmd},{@})
# Better to catch glaring bugs in node than in a browser...
ESBuild.oo = $(call testFor,{<})


# JSToHTML(JS) : Create an HTML file that runs a JS module.
#
JSToHTML.inherit = Builder
JSToHTML.outExt = .html
JSToHTML.command = node {up<} {<} -o {@}
JSToHTML.up = build/js-to-html.js


JSMin.inherit = Builder
JSMin.command = terser --compress "ecma=2015,toplevel,unsafe_arrows" --mangle toplevel --define globalThis.TEST=false -o {@} {<}


include ../minion/minion.mk
