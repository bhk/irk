# Incremental Evaluation

## Index

 * [Overview](#overview)
 * [Principles](#principles)
 * [Implementation](#implementation)
 * [References](#references)

## Overview

The goal of incremental evaluation is to perform a computation on a set of
inputs in such a way that, after a small or isolated change in some of the
inputs, the new result can be computed more efficiently than by
re-evaluating from scratch.

A number of systems make use of incremental evaluation, although their
terminology varies widely:

 - Spreadsheets
 - Build Systems
 - Databases
 - "Reactive" GUIs

In these systems, incremental evaluation is only part of what they provide.
Importantly, they provide facilities to describe the computation (construct
the graph).  It is helpful to distinguish these aspects -- description of a
computation vs. incremental evaluation -- when we describe the design space.

## Principles

These systems support, at least as a subset of their features, the following
more-or-less formalized model of computation:

A computation can be described as a set of *cells* and their *dependencies*
on each other.  *Leaf cells* contain values that are inputs to the system as
a whole.  *Function cells* operate on values produceed by other cells and
yield their own values.  Some subset of the cells are *root* cells, whose
values need to be updated on each evaluation cycle.

A function cell generates a result as a pure functions of its inputs.
Functions are black boxes: we can execute them, and perhaps observe their
interaction with other cells, but we examine their definitions to predict
behavior.  (Many systems allow for side effects and non-determinism, but
that complicates our model so we limit our discussion here to this subset of
functionality.)

As in CS in general, trees are upside down, so when we say "up" we mean
toward the roots, and "down" or "descend" means toward the leaves.


### Survey of the Design Space

First we consider a number of ways to approach constructing the dependency
graph:

 * *Extrinsic dependencies*: In some systems, the set of dependencies
   between cells must be provided independently of the function. In Make,
   for example, the "prerequisites" and "target" of a rule must be listed
   separately from the "recipe".  This is laborious and error-prone.  In
   commonly-used Make-based build systems, users employ libraries written in
   Make to describe build steps, but ultimately these produce for Make a
   recipe, prerequisites, and a target for each rule.

 * *Combinator Libraries*: The entire build can be writted as a program that
   uses "lifted" operators, so while it reads as if it is working with real
   values, it is actually only manipulating nodes in a dependency graph.
   Typically, these cannot directly read *real* values (those seen during
   graph evaluation), so the result is a static graph (as in
   tooltree/jsu/observable.js or [BSalC] secton 3.)

 * *Tracing*: Dependencies can be discovered by oberserving the execution of
   each function and taking note of when it accesses a dependency,
   constructing a *trace*.  (This is a "trace" in the more conventional
   sense; not to be confused with "trace" in [BSalC].)


We can describe some properties of these systems:

 * *Static vs. Dynamic Dependencies*: When the graph is constructed by
   tracing, subsequent re-evaluations might yield different graphs.  This
   can occur whenever a function uses an input value to determine which
   other inputs to use.  A couple of observations on traced dependencies:

    1. Traced dependencies are precise.  Only dependencies that are actually
       requested by a function cell are treated as dependencies.  Other
       approaches to constructing the dependency graph will require an
       overly conservative treatment of dependences in order deal with
       computations whose dependencies are inherently dynamic.

    2. The resulting graph describes the most recent evaluation, but does
       not necessarily describe the steps required for the following
       evaluation.

 * *Persistent Identity*: In a system with dynamic dependencies, we need a
   way to associate a cell in the previous graph with its "self" in the
   current graph.  Otherwise, we could not speak meaningfully of a cell's
   "previous" value, or whether or not its inputs have "changed".

   In a build system, each cell's is associated with a location in the file
   system, and in a spreadsheet, each cell has a pre-determined name.  These
   make naming clear, but at the same time they restrict the programming
   model to one with a finite set of cells.

   When applying incremental evaluation to a general-purpose programming
   languages, naming or identification of cells is a challenge.  We cannot
   base the naming simply on locations in the source code, because the same
   source code can be executed many times, via iteration or function
   invocation.

Given a dependency graph, there are a number of ways to approach
re-evaluation:

 * *Dirty Bit*: One implementation approach is to mark a leaf cell "dirty"
   when its value changes.  (Using timestamps for cells is substantially
   equivalent.)  On re-evaluation, every function cell that depends on a
   dirty cell (transitively) must be recomputed.

 * *Equality Testing*: Another approach is to record the value of each leaf
   cell and function, or a hash thereof.  On re-evaluation, a cell's current
   value is compared with its previous value (perhaps employing hashes) to
   determine whether it has changed.  On re-evaluation, a function cell will
   be recomputed when one or more of its *immediate* dependencies has
   changed.  This will allow us to avoid unnecessary recomputation if we
   process the nodes in a bottom-up fashion (visiting the dependencies of a
   node before the node itself).  [In [BSalC], the set of previous values is
   called a "trace" and the term "early cutoff" refers to avoiding of
   re-calculation of nodes whose transitive dependencies have changed, but
   whose immediate dependencies have not.]

 * *Result caching*: Multiple previous results of a function cell can be
   stored along with the values (or hashes) of its inputs, so that during a
   evaluation when the values of the inputs all match an earlier evaluation
   cycle (not necessary the immediately preceding one!) the earlier result
   can be supplied without re-computing the function.  (This introduces the
   problem of determining how many results to retain, and how long, but we
   don't concern ourselves with that here.)  [This is is called
   "Constructive traces" in [BSalC].]


### Minimality

We define a re-evaluation cycle as *minimal* when it evaluates only cells
that are (a) invalid, and (b) live.  A cell is *invalid* when its immediate
inputs have changed since the previous evaluation.  A cell is *live* when it
is a root or transitive dependency of a root in the *current* evaluation
cycle.  (We ignore the effects of caching multiple results for this
discussion, and presume only a single previous result is available for each
cell.)

A simple *dirty bit* strategy clearly falls short of minimality for a number
of reasons.  A function that transitively depends on a changed leaf cell
will be marked dirty and re-evaluated, yet its immediate inputs might remain
unchanged.  Also, a leaf cell might change from value A to B and back to A
between evaluation cycles, leaving it dirty but unchanged.

A system using *equality testing* with a straightforward bottom-up strategy
meets the first condition of minimality (invalidity), but it can easily run
afoul of the second (liveness) when dynamic dependencies are considered.  A
function cell that was part of the *former* dependency graph might not
appear at all in the *next* dependency graph, the one that will result from
the current re-evaluation cycle.  In fact, it is easy to construct scenarios
where an incremental algorithm will re-compute *more* function cells than a
non-incremental evaluation.


### Liveness Verification

It would seem that the invalidity and liveness constraints of minimailty are
opposed, since a bottom-up traversal determines validity, while a top-down
traversal is needed to determine liveness.  However, it is possible to
have the best of both worlds.

First, we augment our dependency graph with the chronological ordering of
each cell's dependencies.  The order in which a function cell requests each
of its dependencies turns out to be crucial information.  We call the
sequence of dependencies that a cell used in the previous evaluation cycle
its "former dependency list" ("former" to clarify that it may differ from
the dependency list currently being constructed).  We can make the following
observations:

 * The root node is live (by definition).

 * If a cell is live, we know that the first cell in its former dependency
   list must also be live, because at the time a cell requests its first
   dependency, no input values are available to influence its decision to
   use that dependency.  Similarly, if a cell is live and its first former
   dependency is *unchanged*, then we know its second former dependency must
   also be live, since nothing has changed that can affect its liveness.
   Generalizing, we know that the Nth dependency is live when the first N-1
   dependencies are unchanged.  Finally, when all of a cell's former
   dependencies are unchanged, the cell itself is unchanged, and the current
   dependency list remains the same as the former dependency list.

 * When visiting the former dependencies in chronological order, we only ask
   whether the dependency has changed *after* we know it is live.
   Determining whether it has changed may involve recomputation, but only if
   it is invalid.  Therefore, this triggers recomputation only for cells
   that are invalid *and* live.

 * If we find that one of a cell's former dependencies *has* changed, we can
   no longer conclude that any of the remaining former dependencies will
   remain live.  However, we then can conclude that the cell is invalid, and
   must be recomputed in any event, so we can proceed to recompute it,
   during which we trace its *current* dependencies, which are by definition
   live.

An algorithm that applies the above principles has both top-down and
bottom-up aspects: it proceeds top-down verifying liveness in a pre-order
traversal, and performs re-computations in post-order.

#### Liveness and Faults

When a system verifies liveness before computing a cell, it not only
minimizes the number of cell computations, it also avoids potential faults
and non-terminating computations.  By contrast, a bottom-up algorithm that
does not verify liveness may encounter a fault or infinite loop what would
not be encountered by ordinary (non-incremental) evaluation.

#### Parallel Execution

For now we only make a few observations about parallel evaluation:

 * In a multi-processing environment, computing cells in parallel
   speculatively -- before they are known to be live -- could improve
   performance.  So a "minimal" strategy might not be "optimal".

 * When performing speculative execution, faults will have to be contained,
   and when it is determined that a function cell is not live, its speculative
   execution must be terminated (or else it might continue forever).

 * If individual functions support parallel evlauation of dependencies, then
   the system could benefit from tracking both start and end times of
   dependencies.  For example, if, in a previous evaluation cycle, a cell's
   second dependency began execution before its first dependency yielded its
   result, then we know that the liveness of the second dependency does not
   depend on the result of the first dependency.  This should allow a large
   degree of parallelism without speculation.


### Memoization

Memoization and our model of incremental evaulation both aim to optimize by
re-using previous results.  Both work on the principle that when inputs to a
function do not change, the result does not change.

Memoization is described in terms of pure functions, while our incremental
evaluation model describes cells with changing state (e.g. file system
contents), but this difference is a matter of perspective.  We can eliminate
changing state if we treat global state as a value that is passed to every
cell.  Then an essential difference between memoization and our incremental
model becomes apparent: with memoization, any change to the global state
invalidates all results, whereas in our incremental model a cell will be
invalidated only when there is a change to the specific part of the global
state that it accesses.

We can imagine an enhanced, finer-grained variant of memoization that
side-steps this limitation.  We use a "getter" function to model the global
state (e.g. file system), and observe how it is called and what it returns
when each memoized function executes.  Those returned values, rather than
the global state in its entirety, then can be incorporated into the key used
to look up cached results.  (Implementing this observation will require
mutative code, or perhaps a specialized interpreter that provides tracing
hooks, but the code being memoized is purely functional.)

We can then cast this enhanced memoization back into our mutative
incremental model.  The file system "getter" remains constant, but it
contains cells: a cell's value may vary over time, and we can ask whether it
has changed since the last evaulation.  When the memoization, `f_m`, of a
function `f` is called, the arguments are used as the key to look up a
cached cell.  If there is no pre-existing entry, we construct one by calling
`f`.  The value returned from `f` is the cell's value, and each call from
`f` to a getter constitutes a dependency on the used cell.  Before `f_m`
uses a cached value, it inspects to dependencies to ensure they have not
changed.

Memoized functions of this sort compose nicely to form dependency graphs
that can support minimal evaluation. For example, if memoized functions A
and B are passed to memoized function C, and C calls them, then we end up
with a cell constructed from C with two dependencies: one constructed from
A, and one from B.  Validation of a dependency involves a call to its
function, but when the dependencies are also memoized, this results in a
table lookup, plus perhaps validation of its own dependencies.  Memoization
also solves the problem of persistent identity: the memoization key,
constructed from arguments, uniquely identifies each cell.


## Implementation

We now consider how we can apply these principles within a JavaScript
programming environment.  More specifically, we want to:

 - Describe a computation as a JavaScript function, employing a library to
   identify cell[1] boundaries, so that it can be incrementally updated.

 - Implement liveness verification[1], using memoization as the primary
   model.

Conceptually, we can break the JS function down into primitive operations,
and treat each such operation performed during evaluation of the function as
a cell in the graph.  However, we cannot construct such a fine-grained graph
without writing an interpreter.  However, we don't really want that level of
granularity anyway.  Instead, we use a library-based approach.


### Approach

The library provides a primitive called `wrap` that accepts a function as an
argument and "wraps" it -- that is, it returns a memoized form.  Each
*invocation* of the wrapped function constructs a new cell.

We have different variants of `wrap` that vary along these dimensions:

 1. Will its result be compared to that of the previous cycle, in order to
    reduce propagation of invalidity downstream?  Sometimes this might not
    be worthwhile (e.g. for some cells, invalidation is always followed by a
    new value).

 2. Will results (cells) from earlier in this eval cycle be used?  Within a
    single cycle this is ordinary memoization, and can be used to reduce the
    time complexity of the program.

 3. Will results (cells) from a prior eval cycle be used?  This allows
    *incremental* computation.

It should be clear how #2 can exists without #3, but we can also have #3
without #2 (in its general form) if reuse is limited to children of the same
calling cell.


### Challenges and Questions

 * Input leakage.  If an input changes, we must re-evaluate the cell.

 * Output leakage.

 * Persistency Identification

   Solution: Memoization.

 * Cleanup: How long are memoization results kept?

   Solution: Discard non-live memoization results after each evaluation cycle.

 * What are the things that *change* (from one cycle to the next) -- the
   "inputs" to the whole graph -- and how do we identify them? [A single
   "global state" object is too broad, but a programmer can use "getters" to
   express finer-grained dependencies.]

 * Equality: How do we compare values?  Our default standard for equality,
   `===`, errs in being too strong in some cases and too loose in others.

   - Equivalent, but unequal: Functions and aggregates constructed during
     evaluation of a cell will always compare as unequal to those
     constructed in subsequent cycles.  This leads to unnecessary
     re-computation.

     E.g.: A cell may be re-evaluated, and then, when its parent is
     re-evaluated, be discarded and replaced with an equivalent cell.

   - Equal, but not equivalent: With mutable state, aggregates and functions
     may reference values that hold different contents at different points
     in time.


## Solutions

 * The library compares using `===` when pruning invalidation and when
   identifying matching memoized results.

 * The library provides interning mechanisms.  When value equivalence is
   desired, the programmer can intern results or args.  "x is equivalent to
   y" => "intern(x) === intern(y)."

 * The programmer must avoid mutation of { (a) members of data structures,
   (b) variables captures by closures } when the structure/closure has been
   passed to or returned from cells, except in the following circumstance:

   A cell may modify members of an object as long as those members are
   never inspected by any other cells.  This is used when we create DOM
   elements and later modify them (without re-constructing them).
   Subsequent re-evaluations may modify the DOM element, but this cannot
   result in inconsistency because these changes do not affect the
   behavior of any downstream cells.


TODO:

 - Change over time:
     - "Variables"
     - I/O

 - Our dependency graph is from cell-to-cell, although these are
   under-the-covers things.

 - Function arguments to memoized functions:  need to encapsulate them?

    Scenario A: Filesystem getter with persistent ID;
      pre-encapsulated. (How?)

    Scenario B: Getter constructed as local function by caller of memofunc.
      This has no persistent ID, so each re-eval of caller will discard
      the chid cell.  (No difference.)

 - Persistent state.  For UI elements, provide a constructor that accepts an
   "instance state" parameter, which can at minimum provide the UI event
   stream for the element.  Instance state describes instantiation in the
   GUI layout, and has a notion of identity of the visual representation.
   Interestingly, many properties of the UI element are functions of event
   stream... a circularity that was not clearly apparent before.

 - Pseudo-code...

   getValue = (cell, trace) ->
       # Always: cell is live
       [formerValue, fdl] = trace.get(cell)
       invalid = false
       while not invalid and fdl.length > 0:
           [newDepValue, trace] = getValue(fdl[0].cell, trace)
           invalid = newDepValue != fdl[0].value
           fdl := fdl[1...]
       if not invalid:
           [formatValue, trace]
       # Re-compute
       # Always: cell is live, cell is invalid
       [value, ndl] = cell.traceExec()
       [value, trace.replace(cell, [value, ndl]]


## Other Observations


### Time vs. space

Consider a *reactive program*: an expression that is evaluated, and then
incrementally re-evaluated as events occur that change inputs.  Program
state evolves with time, as changes in external state trigger re-evaluation.

The result of each evaluation cycle defines a state in the program.  This
cycle conceptually instantaneous because no side-effects or varying inputs
are evident within an evaluation cycle.  Data flow as described by
expressions occurs along this evaluation dimension, outside of time.  Call
it the space dimension.

   When debugging, the values in different expressions within a single state
   (evaluation cycle) could be browsed in any order.  There is no inherent
   need for breakpoints or stepping.

These changes may be in response to output operations computed by the
previous evaluation cycle, so another sort of data flow (looping through the
outside world) can be imagined to progress along the time dimension.

   When debugging, one should be able to observe changes in value (of an
   expression in the program, or of an input) are time progresses.  This
   capability would presumably be limited by available storage for cachin.


### "Liveness GC"

When a cell transitions from live[1] to non-live, we can discard its
results, since it is no longer reachable from the program's state.
Furthermore, all of the values that were allocated during evaluation of the
cell are likewise not reachable, and can be discarded.  After all, the
cell's "result" encompasses all data exposed from the cell to the rest of
the program, so once a cell is no longer live, it should be as if it had
never existed in the first place.

This suggests "liveness GC", an alternative to tracing GC or reference
counting for resource recovery.  We do not have to track references
*between* values within a cell.  From the imperative perspective, a
deactivation event can trigger de-allocation operations.  These operations
can be dynamically maintained in a list associated with the cell, so that an
allocation operation may register a corresponding de-allocation operation.

Liveness GC can be more deterministic than tracing GC, so it can be useful
even where GC is already present in the system.

Liveness GC can also recover resources whose lifetimes are not easily
tracked by GC.  For example:

 - The "reference" between a DOM element and the auto-generated CSS class it
   makes use of are embedded in a string (its CLASS attribute).

 - In a system that exposes file descriptors as integers, conventional GC
   cannot determine when to close a file.

 - Cached results (e.g. memoization).

Interestingly, this form of resource reovery applies along the time
dimension, but not along the evaluation dimension.  Recovering storage
within an evaluation cycle would require tracing GC or reference counting.


## References

### [BSalC] Build Systems a la Carte

https://dl.acm.org/doi/pdf/10.1145/3236774

This paper discusses a number of build systems and MS Excel, and lays out
its own map of the design space with its own terminology:

* Self-tracking: the property of incrementally handling changes to the
  build description (e.g. changing a build file).  Build systems, in
  particular, tend not to deal with the implications of changes to the
  build files.  Spreadsheets, on the other hand, do deal with changes to
  function cells.

* Static vs. dynamic dependencies: Whether the dependency graph can
  change over time.  An example given is Excel, which obeserves execution
  of cells and applies some static analysis.

* Restarting vs. suspending: Two ways of handling dynamic dependencies
  (observing dependencies during execution).

* (Early) cutoff: when a recomputed node results in the same value, it
  does not invalidate nodes that depend on it.  (In my libraries cutoff
  involves distinguishing "valid" from "fresh" nodes, which in turn
  requires some notion of equality.)

* Minimal: Their definition of minimality is far from minimal; it does
  not even require the condition of invalidity described in this document
  ("cutoff").

* Rebuild strategies

   - Dirty bit: Mark a cell dirty when it is changed and all cells that
     depend on it transitively.

   - Verifying traces:  What we call equality testing.

   - Constructive Verifying traces: Equality testing with "memoization".

   - Deep constructive traces: This strategy applies equality testing to
     leaf nodes, not immediate dependencies, sacrificing the liveness
     property of minimality we describe above, in order to perform
     speculative computation of some cells (in parallel, presumably).

Quote: "Self-adjusting computation, memoization and build systems are
inherently related topics, which poses the question of whether there is
an underlying common abstraction waiting to be discovered."
