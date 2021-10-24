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

esbuild = ./node_modules/.bin/esbuild


# TestJSB(TEST) : Execute JavaScript file TEST after imprting mockdom.js.
#
TestJSB.inherit = TestJS
TestJSB.scriptArgs = build/import.js ../mockdom.js ../{<}


#--------------------------------
# Generic Classes
#--------------------------------

# HTMLIndex(FILES) : Create HTML index of FILES
#
HTMLIndex.inherit = Write
HTMLIndex.outExt = .html
HTMLIndex.oo = $(_args)
HTMLIndex.links = $(call get,out,{ooIDs})
define HTMLIndex.data
  <!DOCTYPE html>
  <style>
    a $([[)
      display: block; font: 32px sans-serif; margin: 32px;
      text-decoration: none;
    $(]])
  </style>
  $(foreach p,$(foreach i,{links},$(call _relpath,{@},$i)),
    <a href="$p">$(notdir $(basename $p))</a>)
endef

# $(call _relpath,TO,FROM)
_relpath = $(if $(filter /%,$2),$2,$(if $(filter ..,$(subst /, ,$1)),$(error _relpath: '..' in $1),$(or $(foreach w,$(filter %/%,$(word 1,$(subst /,/% ,$1))),$(call _relpath,$(patsubst $w,%,$1),$(if $(filter $w,$2),$(patsubst $w,%,$2),../$2))),$2)))


# Demo(SOURCE): Shorthand that builds JSToHTML(Bundle(SOURCE))
#
Demo.inherit = Phony
Demo.in = JSToHTML(Bundle($(_arg1)))


# ODemo(SOURCE): Shorthand for Open(Demo(SOURCE))
#
ODemo.inherit = Demo
ODemo.in = Open({inherit})


# TestJS(TEST) : Execute Javascript file TEST using node.
#
# We use `--experimental-loader` to track implied dependencies.
#
TestJS.inherit = Builder
TestJS.command = {env} node {depsFlags} {scriptArgs} && touch {@}
TestJS.env = @NODE_NO_WARNINGS=1 TestJS_MT={@}
TestJS.depsFlags = --experimental-loader ./build/node-M.js
TestJS.rule = -include {@}.d$(\n){inherit}
TestJS.scriptArgs = {<}


# Open(FILE) : Launch a browser/viewer on FILE
#
Open.inherit = Phony
Open.command = open -a "Google Chrome" {<}


# Bundle(SOURCE,[min:1])
#
#   Bundle JavaScript file SOURCE with its dependencies.  Minify if `min` is
#   given.
#
Bundle.inherit ?= _Bundle


# _Bundle(...) : Base class for Bundle() implementations.
#
_Bundle.inherit = Builder
_Bundle.min = $(call _namedArgs,min)


# ESBuild(...) : See _Bundle
#
ESBuild.inherit = _Bundle
ESBuild.command = {bundleCmd}$(\n)@{depsCmd}
ESBuild.bundleCmd = @{exe} --outfile={@} {<} --bundle $(if {min},--minify) --metafile={@}.json --color=false --log-level=warning
ESBuild.depsCmd = node -p '(([k,v])=>k+": "+Object.keys(v.inputs).join(" "))(Object.entries(require("./{@}.json").outputs)[0])' > {depsFile}
ESBuild.rule = -include {depsFile}$(\n){inherit}
ESBuild.exe = $(esbuild)
ESBuild.depsFile = {@}.d
ESBuild.vvValue = $(call _vvEnc,{bundleCmd},{@})

esbuild ?= $(error $$(esbuild) undefined)


# JSToHTML(JS) : Create an HTML file that runs a JS module.
#
JSToHTML.inherit = Builder
JSToHTML.outExt = %.html
JSToHTML.command = @node {up<} {<} -o {@}
JSToHTML.up = build/js-to-html.js


JSMin.inherit = Builder
JSMin.command = terser --compress "ecma=2015,toplevel,unsafe_arrows" --mangle toplevel --define globalThis.TEST=false -o {@} {<}


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
