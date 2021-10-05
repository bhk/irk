Alias(default).in = TestJS@tests

tests = i_q.js e_q.js grid_q.js util_q.js

TestJS.inherit = Exec
TestJS.exec = node {<}
TestJS.in = {inherit} $(filter-out %_q.js,$(wildcard *.js))


# rollup.js notes:
#  - no -M functionality, but we can provide a plugin that does it.
#  - `-c` option *maybe* interprets next word as an argument: if begins
#    with `-`, use rollup.config.js, else consume it.
#  - Use `--format iife` if <SCRIPT> does not use `type=module`.
#
Bundle.inherit = Builder
Bundle.command = {env} rollup {<} -c {up<} --failAfterWarnings --file {@}
Bundle.env = MINIFY=1 REMAP='test.js=no-test.js'
Bundle.rule = -include {@}.d$(\n){inherit}
Bundle.up = rollup.config.js


JSMin.inherit = Builder
JSMin.command = terser --compress "ecma=2015,toplevel,unsafe_arrows" --mangle toplevel --define globalThis.TEST=false -o {@} {<}


CSSMin.inherit = Builder
CSSMin.command = csso {<} --output {@}


include ../minion/minion.mk
