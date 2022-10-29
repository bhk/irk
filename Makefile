# make 'ODemo(FOO.js)' : build and open an HTML file that contains
#     FOO.js and its dependencies.  Also tests the bundle by running
#     it in `node` with mockdom.js
# 

Alias(default).in = Alias(test)
Alias(test).in = TestJS@tests TestJSB@demos
Alias(demo).in = JSToHTML@Bundle@demos
Alias(index).in = Open(HTMLIndex(JSToHTML@Bundle@demos))
Alias(player).in = ODemo(player.js)

tests = util_q.js i_q.js e_q.js grid_q.js
demos = e_demo.js drag_demo.js grid_demo.js \
        svg_demo.js exposer_demo.js event_demo.js

# Use ESBuild for Bundle, and validate %_demo.js and %_q.js beforehand
Bundle.inherit = ESBuild
Bundle.oo = TestJSB({<}) \
   $(patsubst %,TestJS(%),\
      $(filter $(tests),$(patsubst %_demo.js,%_q.js,{<})))


# TestJSB(TEST) : Execute JavaScript file TEST after importing mockdom.js.
#
TestJSB.inherit = TestJS
TestJSB.scriptArgs = build/import.js ../mockdom.js ../{<}


esbuild = ./node_modules/.bin/esbuild
node = node
include build/classes.mk

# Ordering of tests (hard-code at least the most important constraints)

TestJS.oo = TestJS(e_q.js)
TestJS(i_q.js).oo =
TestJS(e_q.js).oo = TestJS(i_q.js)

include ../minion/minion.mk
