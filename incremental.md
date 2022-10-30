# Incremental Evaluation


## Outline

  - Introduction
  - Dependency Graph Concepts
  - Programming with Cells
    - Dependency Detection
    - Cell Boundaries
    - Exceptions
    - State Cells
  - Implementation Notes
    - Minimal Update Algorithm
    - Parallel Processing of Updates
    - Scope of Memoization
    - Time vs. space
    - Liveness GC
  - Appendices
    - Equivalence in IFL
    - Equivalence in JavaScript
    - Rewriting JavaScript for Wrapping
    - Build System Overview
    - Survey of the Design Space
      - Note: Result Caching
      - References
    - Notifications
    - Memoization
    - TODO


## Introduction

Incremental evaluation refers to various strategies for performing a
computation in such a way that, after a small or isolated change in some of
the inputs, the new result can be computed more efficiently than by
performing the entire computation from scratch.

Most programmers are familiar with spreadsheets and build systems, which
despite all of their differences (see [SURVEY], below, for a more thorough
discussion) are essentially concerned with enabling incremental evauation.
At their heart, these systems manage a set of values, some of which are
described in terms of computations that make use of other values, and they
allow recomputation to proceed efficiently and automatically after one or
more of the value have been modified.  "Automatic" means that they do not
require the user to manually indicate which values must be recalculated, nor
do they require the user to write code to programmatically identify what
must be updated.

Our purpose for using incremental evaluation is to construct entire programs
and systems in a "reactive" style.  In this approach, we model the current
state of the external world as a set of inputs, and our program maps these
inputs to an output value.  This output value describes a set of changes to
effect, such as a visual representation to be displayed to a user, or a set
of modifications to be made to files or databases.  As the state of the
world evolves over time, the relevant parts of the program are re-evaluated
as necessary, and the resulting outputs are applied.

Our motivation is to eliminate from our program the need to deal directly
with updates and notifications.  The burden of propagating and handling
notifications of change constitues a significant portion of the complexity
(and the potential for defects) in the software we deal with today.  You can
refer to [NOTIFICATIONS], below, for a more analytic breakdown of how this
complexity manifests, but for now consider an everyday example that might
resonate with many people: compare the complexity of a script that prepares
a static report, say in HTML, from a set of database queries, to an
analogous script in a browser that presents a "live" visual version of the
same report that updates continuosly and efficiently.


## Dependency Graph Concepts

A computation can be described as a set of **cells**.  Each cell has a
**value** and a list of other cells called **dependencies**.  Our term cell
corresponds to "cells" in spreadsheets, and to "rules" in Make and other
build systems.  Cells and their dependencies describe a directed acyclic
graph called the dependency graph.

We sometimes refer to dependencies of a cell as its **children**, and the
cell(s) that depend upon it **parents**.

A **leaf cell** contains just a value and has no dependencies.  It may
change over time based on external events.

A **function cell** describes a computation.  It consumes values produced by
other cells and produces its own value.  Execution of function cell yields a
value and a list of dependencies.  This allows for the dependency graph to
have a dynamic nature: it may change over time as the values change.  We
require that execution of a function cell has no side effects and is
deterministic; it is a "pure" function.

A **root** cell describes a program; while the program is "running" is
result value is repeatedly **updated**.  Updating a cell involves
determining the current value of the cell.  In the case of a function cell,
this might involve **recalculating** the cell -- executing its code -- or it
might just involve verifying the continued validity of the previously
computed value.  Each update of the root is called a **cycle**.

We say that a value has **changed** when its value, after any recalc to be
performed in the current cycle, differs from that of the previous cycle.

A function cell is **invalid** when one or more of its *immediate*
dependencies have changed.  After an invalid function cell is recalculated,
it will be found to be either changed or unchanged.

A cell is **live** when it is a root or a transitive dependency of a root
(in the current cycle).

Cells have an associated **dirty bit**.  After an update, every cell in the
graph is **clean** (its dirty bit is false).  Between update cycles, changes
(or *potential* changes) to a external state will mark as dirty the affected
leaf cells *and all cells that depend on them, transitively*.  Dirty state
therefore reflects the notion that the cell must be updated (we must
determine its validity and recalc if necessary).


## Programming with Cells

We now consider how to apply this incremental model to the execution of a
program.  Specifically, we will consider these two approaches:

 - JavaScript library: The program is written in JavaScript, it makes
   library calls at strategic places to enable incremental evaluation.

 - IFL: The program is written in a new language of our own design,
   Incremental Function Language (IFL), and it employs language-provided
   features at strategic places.  We imagine semantics and features for the
   language that result in elegant incremental programs.


### Dependency Detection

The strategy for constructing the dependency graph is to observe which cells
are **accessed** during function cell's execution.  When a function cell's
calculation completes, we have not only the value is produced, but a list of
dependencies (cells that were accessed during its execution).

 - In JavaScript, cells are objects.  The library provides a function called
   `use` that is used to access the cell's.  When a cell is accessed, it
   adds itself to the list of dependencies of the "current" cell (the one
   performing the access).  If `use` is passed a non-cell argument, it
   returns the argument unchanged; this allows code to be written that can
   accept either cells or ordinary values.

 - In IFL, we have our interpreter keep track of these dependencies.  Values
   in our language can be ordinary ("static") values, or "dynamic" values,
   which represent the result of a cell.  Like static values, dynamic values
   can take on any data type, and they can be passed to functions, assigned
   to different variables, and operated on just like any other value.  When
   a primitive operation is performed on a dynamic value -- e.g. requesting
   a property or method -- it constitutes an access.  An access will make
   the dynamic value's cell a dependency of the current cell, and will
   compute a corresponding static value by updating the cell.  From the
   point of view of the cell being executed, the dynamic value is
   indistinguishable from the static value produced by its cell in that
   cycle.


### Cell Boundaries

We can create cell boundaries by "wrapping" expressions within our program
-- indicating that we intend for them to be evaluated in a separate cell.
Subdividing cells can benefit our program by reducing the scope of
recalculation after a change, but only if the resulting cells have different
sets of dependencies.

 - In IFL, we define `&`, a unary prefix operator of lowest precedence,
   which wraps the expression it encloses.  The result of `& x` will have
   the same data value as that of `x`, but it will be dynamic instead of
   static.

 - In JavaScript, since library functions are unable to deal directly with
   expressions, we define a function `wrap` that accepts a function
   argument.  Use of `wrap` will require the user to transform wrapped
   expressions into functions, and to meet other constraints that we will
   elucidate below, after we clarify the semantics.

Note that we should not expect to have one cell for each wrapped expression,
because during a single update cycle an expression might be evaluated not at
all, or many times, resulting in potentially different values each time.
Instead, a cell represents an *evaluation* of a wrapped expression.
Furthermore, while *evaluations* of a wrapped expression will create a new
cell, some will (hopefully!) reuse a cell that was calculated in an earlier
update cycle.

We define **evocation** to mean the evaluation of a wrapped expression.  A
cell is **evoked** when it is created or reused as the result of an
evocation.

A cell *may not* be reused when its result will not match that of the
evocation.  Conversely, reuse *may* occur whenever it is assured that the
reused cell will yield a value equivalent to that of evocation.  (This is an
extensional notion of cell equality.)

It is impractical to guarantee reuse in all of the allowable cases, but some
guarantee of reuse is important for writing programs that exploit the
benefits of incremental evaluation.  Therefore, we *guarantee* reuse when
equivalence and candidacy are both **evident**, as given by:

 * Equivalence is evident when the expression is the same and when its
   captures (values of unbound variables in the expression) are the same.
   (This is an intensional notion of equality.)

 * Candidacy is evident when a cell eligible for reuse was evoked by the
   currently evoking cell either in the previous or current update cycle.

Our JavaScript library cannot provide this guarantee without some help from
the user, since it cannot examine the values of captures nor analyze the
equivalence of expressions.  Therefore, the user must rewrite the code
to achieve the following:

 - Replace the expression with a call to a constant function that has no
   mutated captured variables.  Any captures that might differ from
   evaluation to evaluation must be converted to explicit parameters to the
   constant function.

 - Use `wrap` to convert the constant function into one that instantiates a
   cell.

When the wrapped function is called, the library will have be able to
inspect the function, which identifies the wrapped expression, and the
arguments, which convey the mutable captures that were accessible by the
original expression.

See [[Rewriting JavaScript for Wrapping]], below, for a more concrete
discussion.

See [[Equivalence in IFL]] and [[Equivalence in JavaScript]] for more
details on how equivalence is determined in each environment.

Note: "P evokes C" does not necessarily imply "P uses (depends on) C".  C
might be part of the result of P.  Some third cell might use P to obtain C,
and then use C to obtain its value.  Likewise, a cell that has been evoked
(and in the scope of reuse) is not necessary a live cell.  Live cells are
those that are part of the dependency graph, which means that they have been
used (and therefore, calculated).


### Exceptions

Exceptions (faults, errors, assertion failures) terminate evaluation of a
cell, putting the cell in an error state.

When a cell is in an error state and its value is accessed by another cell,
the accessing cell also enters an error state and its execution is halted.

However, it is possible to detect the error state of a cell.  Detecting an
error state will mark the cell as a dependency of the current cell, but not
return its value.

 - IFL: `errorOf v` returns an error value when `v` is a dynamic variable in
   an error state, and `null` otherwise.

 - JS: `useError(v)` returns an exception value when `v` is a cell in an
   error state, and `null` otherwise.

Note that errors will ordinary propagate downstream through cells, following
the data flow, *unless* some intervening cell detects the error state and
handles it without attempting to access the value.

If a "root" node enters an error state, this will terminate execution of the
program, reporting the error to the console.


### State Cells

In JS, `newState(initialValue)` constructs a state cell.

`cell.set(newValue)` can be used to modify the value of a state cell.  This
can be called outside of the reactive comain (that is: outside of the scope
of a cell recalc).

If `set` is called during an update cycle -- while another cell is being
recalculated -- this will be detected and a fatal error will be thrown.


## Implementation Notes


### Minimal Update Algorithm

We consider the work done during a update **minimal** when it recalculates
function cells only when they are invalid and live (in the curent cycle).

Achieving a minimal update may appear to be impossible because it seems to
involve a circularity.

If our algorithm proceeds "upwards" from the root, traversing dirty
dependencies recursively, we will ensure that only live nodes are visited,
but we might end up recalculating valid nodes (those whose dependencies were
unchanged after recalculation).

Alternatively, we can proceed from the dirty leaves, traversing "downwards"
to cells that depend upon them.  We can stop when we find that, after
recalculation, a cell remains unchanged.  The problem here is that we are
starting as leaves of the **former** dependency graph (the one constructed
on the previous update cycle).  At some point, a recalculation might produce
a different set of dependencies, one that now excludes some of the cells
that we have already recalculated.

However, if we ensure that a cell's dependency list is ordered by time of
access, we can infer enough information about liveness to proceed while
guaranteeing minimality.  Consider:

 * If a cell is live, its first dependency must be live.  Since the function
   is deterministic, and it has not yet consumed any changed values, it must
   request the same dependency it requested last time.

 * Generalizing this: if a cell is live and its first N dependencies are
   unchanged, then dependency N+1 is live.

We define an algorithm for updating a cell, and require that it only be
invoked on cells known to be live.  The algorithm proceeds to recursively
update the cell's dependencies, one after another, until it finds one that
has changed.  If none of them have changed, then the current cell is valid
and we are done.  Otherwise, we can conclude the current cell is invalid,
and we recalulate it.  During recalculation, we update each dependency as it
is discovered (requested by the recalculating cell).  Note the following
properties of this algorithm:

 * We recursively update dependencies only when they are known to be live.

 * Recalculation only happens when the cell is invalid and live (since
   update is only performed on live cells).

Since the root cell is by definition live, we can begin by updating the root.


### Parallel Processing of Updates

The update algorithm described above proceeds one cell at a time.  This can
be extended to enable parallel execution, but we will not dive into those
complications.  For now we only make these observations:

 * A system might speculatively recalc cells not yet known to be live.

 * When performing speculative execution, precautions must be taken to
   protect against faults and non-termination.  Recalculating non-live nodes
   is equivalent to executing otherwise-unreachable code.

 * When function cells employ multiprocessing, each recalc will result in
   dependencies being updated or recaled in parallel.

 * The potential for parallel invocation of dependencies could be inferred
   from evidence of parallelism (e.g. overlapping time frames in the most
   previoss recalc), or perhaps from knowledge of how parallelism is
   employed in the code (e.g. help from the language runtime).


### Void Cells

Cells that yield no value (or, more generally, those that yield a constant
value) are a special case.  These are sometimes used for side effects --
they consume incrementally computed values and send them out into the
enclosing environment (e.g. the DOM tree).  When their dependencies change,
they are marked dirty, which ensures their recalculation, wherein they can
re-apply their side effects.  Dirtying the cell dirties its parent, and its
parent, and so on, to the root cell where it ensures an asynchronous update
will be performed, which will then propagate back up the dependency graph to
the void node.

It would be possible to handle void cell recalculation more directly.
Instead of marking its parent dirty, a void cell could directly register
with the root, which would place it in a list.  After the ordinary update
algorithm completes, it would then proceed to update each "dirty void", but
only those that remain live.  A dirty void cell may be non-live (having no
parents) after the ordinary update, in which case it should be skipped.

There is however, one unfortunate complication.  The "dirty voids" update
might itself affect the liveness of dirty void cells.  So, to avoid updating
non-live cells, we must apply these dirty void updates in the appropriate
order ... which is the order as determined by walking the dependency graph.
If we had an efficient way of ordering the dirty voids, we could apply it to
all cells in general!  But one other possibility is to simply avoid this
optimization for dirty voids that have other dirty voids as descendants
(indirect dependencies).

The parent-child relationship is still important for determining liveness
and controlling the lifetimes of these cells, but the parents do not need to
be directly involved in recalculation since void cells cannot affect them.


### Scope of Memoization

We may provide variants of `wrap` that vary along these dimensions:

 1. Dirty => Invalid.  Results are not compared with those of the previous
    cycle.  [For some cells, invalidation is always followed by a new value,
    so comparison is pointless.]

 2. Scope of reuse includes all cells in the graph, not just cells evoked by
    the current evoking cell. [Within a single cycle this is ordinary
    memoization, and can be used to reduce the time complexity of the
    program.]

 3. Scope of reuse excludes prior cycle.  [Basic memoization, without
    incremental evaluation.]

 4.  No reuse.  Evocation => creation of a cell.


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


### Liveness GC

When a cell transitions from live to non-live, we can discard its
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


## Appendices


### Equivalence in IFL

IFL data values are immutable and unpolluted, so equivalence is unambiguous.
Equivalence of functions or expressions, however, is more complicated.

In IFL, we use intensional equality to compare functions or to compare
expressions at a given place and time.  This compares the structure of an
expression or function *and* the meta-values of every one of its capture
(free variable).

 - A "meta-value" refers to the data in the case of a static value, or to
   the cell in the case of a dynamic value.  Captures might reference
   functions, in which case a similar intensional defintion of equality is
   used: the definition of the function body *and* the meta-values of its
   captures are all compared.

 - The definition of structure comparison is left somewhat loose, but the
   key requirements that must be met are: (1) intensional equality must
   imply extensional equality (colloquially: "when two functions are
   'equal', they must behave the same, but not necessarily vice versa"), and
   (2) if the program text has not changed and the values of captures have
   not changed, the must compare as equal ("a function must be equal to
   itself").


### Equivalence in JavaScript

In JS, testing equality (to detect changes) is problematic.

 - Comparison can be costly.
 - Functions are opaque.
 - Data structures and captures are mutable.
 - Object addresses (identity) can be compared.
 - Objects holds references to other mutable objects.

The user must be aware of the approach used by the library, and the
programming strategy it suggests.

1) The library **interns** values passed in to wrapped functions, and values
   returned from cells.  Comparing interned values with `===` is a robust
   test for equality.

   Interning converts Arrays and simple objects (those whose constructor is
   `Object`) to a canonical, immutable (frozen) instance.  When the value
   belongs to an inherently immutable type (string, number, etc.), the
   result of interning is the same as the input.

   Complex objects (those with user-defined constructors) and functions are
   not internable, so any two instances will be treated as unequal.

   For example, the following will leave `s` in a non-dirty state:

      s = newState([1,2,3]);
      s.set([1,2,3]);

   The immutability of canonicalized values helps avoid any mutation that
   would invalidate our assumptions.

   The canonicalization helps ensure that when we treat values as
   equivalent, they are actually indistinguishable, so computed results
   should be deterministic.

   While interning can be an expensive operation, it is always fast when
   performed on a canonicalized instance.  In the case of canonical Arrays
   and Objects, their elements and properties are also canonical.

2) Use of non-internable values may result in too much recalculation (when
   used in cell results) and in failure to re-use cells (when used as
   parameters to wrapped functions).

   Note that in the case of local functions, a new function is constructed
   every time the function statement or expression is evaluated.  For
   example, the following will leave `s` in a dirty state:

      let ff = () => (x => x);
      s = newState(ff());
      s.set(ff());

   To avoid this, use functions defined in a scope with a sufficiently long
   lifetime.

2) Also, of non-internable values may result in not enough recalculation
   (when used in cell results) and in incorrect re-use of cells (when used
   as parameters to wrapped functions).

   This can happen because of the mutability of these values.  When a value
   changed after being used as a cell result or input, it might still be
   treated as "the same" on a later update cycle, even though it is not.

   To avoid these problems, use "constant" functions (those who do not
   reference captures that are mutated) and constant data structures (those
   that are not mutated by your program) when equality is relevant.  Note
   that the requirements are transitive.  A function is not constant if it
   calls (via a capture) a non-constant function.

   (The library's public API functions can be excluded from this analysis;
   while they may read and write global variables they are specially
   constructed to insulate cell functions from nondeterminism.)


### JavaScript Root Context

When JavaScript begins execution, and when JavaScript callbacks fire, code
is executing outside of the context of any cell's update() method.  Here we
define how the library's functions behave in this outermost "root" context.

We create a cell called the root cell and treat it as the current cell when
code is executing in the root context.  The root cell is self-updating,
using `setTimeout` to trigger its own updates asynchronously whenever it is
marked dirty.

When any cell is used in the root context, it becomes a dependency of the
root cell, and thereby is *activated* -- that is, it will be automatically
updated if it become dirty.  If any of these cells enter an error state, the
error will be reported, which will terminated program execution in a
command-line environment.  Likewise, when `use()` is called in the root
context, cell errors will not be caught.

Cleanup functions that are registered with `onDrop(f)` in the root context
will generally not ever be called.  This is appropriate for resources that
have the lifetime of the entire program.


### Rewriting JavaScript for Wrapping

Here we provide an example of rewriting JavaScript expressions to allow
`wrap` to be used to introduce cell boundaries.

Consider this IFL example:

    C0 = (X, Y, Z) ->
       f = i => 2 * & i + Y * Z
       f(1) + f(X) + f(1)

Execution of C0 will result in two child cells.  When X=2, Y=1, and Z=0, we
can summaries the resulting cells and their dependencies like this:

    C0=4: C1=1, C2=2
    C1=1: Y=1, Z=0          1 + Y * Z
    C2=2: X=2, Y=1, Z=0     X + Y * Z

Now let's consider the an almost-JavaScript equivalent to the above code
("almost" because it retains the `&` operator as if it had meaning in JS):

    const C0 = (X, Y, Z) => {
       const f = i => 2 * use(& use(i) + use(Y) * use(Z));
       return f(1) + f(X) + f(1);
    };

Our first challenge is to rewrite the `& ...` subexpression as a function
that refers to no mutable variables.  Any such mutable captures must be
converted to parameters.  Assuming that both Y and Z are mutable, that gives
us:

    const sub_ = (i, y, z) => use(i) + use(y) * use(z);

We then `wrap` the resulting function:

    const sub = wrap(sub_);

We can then replace the `& ...` expression with a call to `sub.cell`, or
replace `use(& ...)` with a call to `sub`.  The resulting transformed code
looks like this:

    const sub_ = (i, y, z) => use(i) + use(y) * use(z);
    const sub = wrap(sub_);
    const C0 = (X, Y, Z) => {
       const f = i => 2 * sub(i, Y, Z);
       return f(1) + f(X) + f(1);
    };

Importantly, the constant function must be defined in a scope that has a
lifetime greater than or equal to that of any of the cells that we intend to
construct with it.  Moving it to the outermost scope is a simple solution.
In the case of object methods, a "bound" function can be constructed and
wrapped when the object is constructed.  For example: `this.method =
wrap(this.method.bind(this))`.

The call to `wrap` *may* be performed anywhere, but for the sake of
efficiency we call it just after constructing the function it wraps.


### Build System Overview

Overview outline: Start with Make & Spreadsheets

  A) a priori graph of cells: (fn, deps)

     Morphism: (A, fn:A->B) <=> Cell(A) / fn:Cell(A)->Cell(B)

     Edge => invaliation (`A-->B` means that a change in A might result in a
     change in B)

  B) "Discovered graph"; On each evaluation, detect deps and update them.

      - e.g. scanner, or have fn (e.g. `gcc`) return them

      - deps is now a fn of time, just like result -- not just a
        time-varying value, but a time-varying list of time-varying values.

      - Note fn has *potential* access to *more* inputs.  The file system is
        a time-varying "input" that we ignore for the purpose of dependency
        tracking; if we didn't ignore it, any change to the FS would
        invalidate everything!  But: every access must track deps.  We must
        ensure: deps@T will *cover* all changes that might affect result@T.

If functions can be changed...

 - Detect change => compare fn's, no?

 - Conservative extensional equality (=~=): We do not need to be able to
   know perfect extensional equality; but we need at least to guarantee that
   f1 =~= f2 => f1(x) = f2(x), at any point in time.  Intensional equality
   would satisfy that.

Relate to programming languages (or at least Rio)

 - Results generally in-memory (but could also be persistent sometimes)

 - Consider simple case: {Val, Fun, App, Arg}

 - We can create an alternative interpreter that works on cells, not
   values, and constructs a graph while it computes values.

 - Note: cell <=> *invocation* of a function, not the function.
   This differs from make/spreadsheets in that cells may be anonymously
   instantiated ... e.g. in a loop.

    - Arg references a cell
    - An invocation of a primitive creates a cell with all input
      cells as inputs.
    - Invocation of a user-defined function is the same except the
      fn itself becomes a dependency.

 - Function equality and function cell identity...

    - These offer *potential* access to *many* inputs.

    - (Same problem with file system, and with aggregates ...)

    - So: *ignore* time-varying values (within cells) when comparing fn's,
      but detect accesses and track them. Captures must be cells, not
      extracted values.

    - So we *ignore* the time-varying values in the function (captures)
      as long as they are "wrapped" in cells (identity remains same).

    - Non-wrapped time-varying values will invalidate: a change to a
      capture that was obtained from

 - Identity for variable inputs (Cells), not just values.  Value =
   Cell@Time.


### Survey of the Design Space

Importantly, they provide facilities (e.g. a "language") to describe the
computation.  It is helpful to distinguish these aspects -- how computation
is described vs. how incremental evaluation is approached -- when we
describe the design space.

First we consider a number of ways to approach constructing the dependency
graph:

 * *Manual*: In some systems, the set of dependencies between cells must be
   provided independently of the function. In Make, for example, the
   "prerequisites" and "target" of a rule must be listed separately from the
   "recipe".  This is laborious and error-prone.  In commonly-used
   Make-based build systems, users employ libraries written in Make to
   describe build steps, but ultimately these produce for Make a recipe,
   prerequisites, and a target for each rule.

 * *Programmatic*: Graph construction can be performed by a program that
   uses "lifted" operators, so while it reads as if it is working with real
   values, it is actually only manipulating nodes in a dependency graph.
   Typically, these cannot directly read *real* values (those seen during
   graph evaluation), so the result is a static graph (as in
   tooltree/jsu/observable.js or [BSalC] secton 3.)

 * *Scanning*: Dependencies can be discovered by examining the function and
   its inputs, "second guessing" the run-time behavior of the function.  A
   subset of the dependencies might be provided to this scanning process as
   inputs.

 * *Inference*: Another alternative is to inspect the definition of a
   function to infer its dependencies without executing it.  For
   Turing-complete languages this is not computable, but for many simple
   languages this is practical.

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

Given a dependency graph, there are two common approaches to assessing the
need for recomputation of a cell:

 * *Notifications*: One approach is to consider a leaf cell *dirty* if any
   writes to it (potential changes) have occcured since the last
   (re-)evaluation.  If the system is aware of writes as they happen, it can
   maintain a dirty bit for each leaf cell.  If the leafs are all files in a
   file system that tracks modification times, those timestamps can be used
   to detect this "dirty" state when re-evaluation is performed.  On
   re-evaluation, the system will recompute every function cell that depends
   (transitively) on a dirty cell.

   [GNU make diverges from this strategy in that it does not necessarily
   re-evaluate all nodes that transitively depend on dirty leaf nodes.  In
   Make terminology: a rule's command will be issued when its inputs are
   newer than its output file.  We might have some rule whose "grandparent"
   dependency has changed, but whose "parent" (immediate) dependency has not
   changed.  This will occur only if the parent rule's command did not
   update the output file (even though it was invoked).  This appears to be
   an un-useful, pathological case, so we leave this approach outside of the
   design landscape we're surveying.]

 * *Equality Testing*: Another approach is to record the value of each leaf
   cell and function, or a strong hash of the value.  On re-evaluation, a
   cell's current value is compared with its previous value (perhaps
   employing hashes) to determine whether it has changed.  On re-evaluation,
   a function cell will be recomputed when one or more of its *immediate*
   dependencies has changed.  This will allow us to avoid unnecessary
   recomputation if we process the nodes in a bottom-up fashion (visiting
   the dependencies of a node before the node itself).  [In [BSalC], the set
   of previous values is called a "trace" and the term "early cutoff" refers
   to avoiding of re-calculation of nodes whose transitive dependencies have
   changed, but whose immediate dependencies have not.]


#### Note: Result Caching

When equality testing is in use for validity checking, it can also be used
to optimize re-evaluation by memoizing function cells.  The system can cache
previous outputs of the cell, indexed by the inputs (or hashes of inputs).
When re-evaluation is required, and when a cache entry matches the current
set of inputs, the earlier result can be supplied without re-computing the
function.  (This introduces the problem of determining how many results to
retain, and how long, but we don't concern ourselves with that here.)  [This
is is called "Constructive traces" in [BSalC].]


#### References

[BSalC] Build Systems a la Carte

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


### Notifications

Where we need code:
 * Code that registers for notifications
 * Code that handles those registrations
 * Code that delivers notifications
 * Code that handles the notifications
 * Code that de-registers
 * Code that handles de-registration

Systemic problems:
 * Deregistering => explicit lifetime management
 * Registration => reference cycles


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


### TODO

 * Summary

   A "cell" corresponds to an *evaluation* of an expression in an
   *incremental* mode.  Various modes a language might support:

     - Strict: evaluate when constructed.
     - Lazy: evaluate when value is used.
     - Concurrent: start on construction, join on use.
     - Incremental: reuse in next update cycle.

   Incremental may be combined with strict/lazy/concurrent.

 * Reactive GC

    - Liveness provides a scope for memoization

 * Reactive I/O

    - Inputs magically appear over time
    - Outputs... ????


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
       [value, trace.replace(cell, [value, ndl])]
