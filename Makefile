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
# Ordering of tests...
ifeq (1,1)

  # Hard-code the important ones...
  TestJS.oo = TestJS(e_q.js)
  TestJS(i_q.js).oo =
  TestJS(e_q.js).oo = TestJS(i_q.js)

else

  # Auto-scan...
  TestJS.oo = $(patsubst %,TestJS(%),$(filter-out {<},$(call testsFor,$(call jdepsOf,{<}))))

  jdoKeys = $(filter-out :%,$(subst :, :,$(jdo)))
  jdepsOf = $(subst :, ,$(call _hashGet,$(jdo),$1))
  testsFor = $(filter $(jdoKeys),$(patsubst %.js,%_q.js,$1))

  # JSDeps(SOURCES): Generate a makefile that describes dependencies of all SOURCES.
  #
  #     Dependencies are stored in a hash under the variable name {var}.
  #
  JSDeps.inherit = Builder
  JSDeps.var = jdo
  JSDeps.vvFile =
  JSDeps.command = \
     @printf '%b\n' '$(foreach i,{^},import "./$i"\n)' | \
     $(esbuild) --bundle --metafile={@}.json --outfile=/dev/null \
        --color=false --log-level=warning && \
     node -p '"{var} := "+$(call jdfn,{@}.json)' > {@}

  jdfn = Object.entries(require("./$1").inputs).map(([t,o]) => \
        t + ":" + o.imports.map(i => i.path).join(":")).join(" ")

  # Todo:
  #  - transitive closure of dependencies
  #  - Include makefile before instances are eval'ed
  #      minion_start=1
  #      include ../minion/minion.mk
  #      $(call _evalRules,Include(JSDeps(@tests)))
  #      $(minion_end)

endif

include ../minion/minion.mk
