# ROP: Remote Observation Protocol


## RPC Overview

Consider the problem of writing programs in two different **domains** that
need to communicate with each other.  We presume the ability to establish a
**channel** that allows communication.  Perhaps the most fundamental model
of a channel is one that allows **messages** (packets) to be sent between
the two domains.  Another common model is that of a bi-directional data
stream.  Since we we implement one in terms of the other, we won't dwell on
this choice, and will simply assume a message passing model.

### Ad hoc

One approach is to write an agent for each side of the communication
channel, and define a set of messages and the meanings for those messages,
and write code to construct and de-construct those messages.

### RPC: The Procedure Analog

The Remote Procedure Call (RPC) model abstracts the communication layer away
as a set of procedure calls.  This allows programs to use the communication
layer by implementing ordinary procedures in one domain and then calling
them from code in another domain.

This involves **proxy** software on both sides of the communication channel.
In the caller's domain, there is an procedure that looks like the
implementation procedure, sending a request message to the remote domain and
receiving a response message.  In the implementing domain, there is software
that receives the request message and calls the procedure's implementation.

The keys benefits of RPC are:

- Simplicity: A simplified mental model of the communication layer.

- Generalization: A systematic approach to marshaling can be defined, in
  which data types in the target language are mapped to specific
  serializations in messages.  Instead of having a bespoke implementation of
  each pair of proxies, the approach to marshaling each procedure is
  well-defined.

- Convenience: We can have tooling that generates proxies from an interface
  description.

- Interoperability: Functions that are accesible via RPC may also be
  accessible locally without the communication layer.

### RPC Protocol

The protocol can be summarized with a set of message types:

   Message = Invoke procedureID inputs
           | Response outputs

Furthermore, we can augment each message with a transaction ID (`xid`) to
correlate responses with requests, so that a single channel can support more
than one in-progress transaction at a time.

   Message = Invoke xid procedureID inputs
           | Response xid outputs


## RMI: The Object Analog

One complication that arises in RPC is the handling of **contexts**:
resources or memory that are allocated in the implementation domain during
certain procedures and *not* marshaled as returned values, but referenced in
subsequent procedure calls.  These must be handled by the type system and
proxy software of the remoting infrastructure in order to ensure the
following:

 1. Validity.  A remote domain must not be able to cause an implementation
    to operate on an invalid context reference, or to operate on a valid
    context of the wrong type, or to operate on a context that is "owned"
    by another domain.

 2. Cleanup.  When a channel is closed, for example when a remote domain is
    lost or restarted, resources held by that domain must be cleaned up.

Once we recognize the need for the remoting infarstructure to be aware of
contexts, their ownership, and their association with procedures, we might
as well take the additional step of orienting communcation around contexts
(we can call them *objects* or *closures*) instead of procedures.  Each
object can define its own "interface": the structure of its arguments and
results.  The transport layer needs to know of only three functions:

   message = Invoke xid oid inputs
           | Response xid outputs
           | Release oid

Here, an **OID** is a number that identifies the object being invoked.
Also, `inputs` and `outputs` may contain oids that reference objects in
either the calling domain or the destination domain.

This maps to a familiar mental model and programming model that is
compatible with the internal logic of the communication system, and it
enables a number of other benefits:

 - Modularity in the infrastructure.  No central authority needs to know
   about all of the different method signatures in the entire system.
   Proxies are objects that expose some specific interface, and a proxy
   needs to know about only those interfaces used by objects that appear as
   inputs or outputs in its own methods.

 - Modularity in implementations.  Objects or closures are superior to
   stateless procedures as a software abstraction for building modular
   softwre.  Interchangeability of implementations (aka polymorphism) is one
   concrete example.  For example, code written to read from a file may be
   used to read from a local file, or from a file remoted from domain A, or
   from domain B.

 - Lifetime management.  When a peer is destroyed, objects references held
   by it are relased.  Every object understands "release", which provides a
   universal model for cleanup.

 - Capability-based security.  OID-to-context resolution is done at the
   transport, which knows what resources have been granted to the peer
   domain.  One of its responsibilities is to reject any requests that
   reference invalid OIDs.  In the native environment, contexts do not need
   to be validated, and we avoid polluting our language binding with the
   notion of "calling domain".

 - Chaining.  Object references can span multiple channels without a round
   trip through the native abstraction layer.  The intermediate domain does
   not need to know about the interfaces being used.  (This eequires
   run-time unwrapping of proxy -- QI or dynamic cast.)

## Other Concerns

There a number of related concerns to consider when specifying a remoting
protocol or implementing the infrastructure:

[TODO...]

* Object references
   - Unwrapping forwarders => local objects
* Flow Control
   - sub-message granularity?  (or punt)
   - message size limit
   - buffering limit (all messages)
* Re-entry and threading
   - apartment models
   - Synchronous re-entry?  Only from calling thread?
   - asynch bindings?
* Notifications and Reference Cycles
* One-way invocations
   - one-way release => avoids re-entry
* Transport-layer Semantics
   - Errors
   - QoS
* Chaining (without transport-to-native-to-transport conversion)
* Types of Domain Boundaries
   - language boundary: C => Rust => C++
   - VM boundary
   - process/kernel
   - inter-process
   - network (sockets, HTTP, ssh, ...)
* Security Concerns
   - peer-to-peer vs. parent-child domains
   - leakage (padding)
   - validation (alignment, bounds, etc.)
   - capabilities & confused deputy


## ROP: Reactive Observation as an Analog

 - Avoid re-entry and threading problems
 - Avoid inefficiency and complexity with notifications
   (Recipient objects, registration objects)
 - Avoid circular reference GC problems with notifications
 - kqueue-like semantics: persistent registration w/ single thread
 - synch/asynch vs. reactive
 - streams: append vs. replace ?

Aproach:

 * Replace invocations replaced with "observations":

    - Invoke -> Open & Close
    - Response -> Update

 * AckUpdate enables flow control *and* OID lifetime management.

 * AckClose enables slot and OID lifetime management.

 * It appears Release is not required, because each agent can use "reactive
   GC" and define the "live" set (those held by the peer) as the objects
   referenced by currently open observations.

   The *live set* includes local objects referenced by the most recent
     outbound Update for each observation, or by the Open of an active
     outbound observation.

     Additionally, we might consider inbound Open messages to be part of the
     live set, since these might reference local objects.  The reason we
     would *not* include these is that in an incremental system, when the
     source of an object becomes dead, any downstream calculations based on
     it become moot, so we would expect an incrementally-recalculated peer
     to close all observations on an object immediately after the object's
     source becomes dead.  However, this might present a practical challenge
     for agents to ensure that stale OIDs are never used.

   OID Lifetime Synchronization: An outbound message (Update or Close) that
     makes an OID "dead" might cross paths with an inbound Open that
     references it.  Therefore we need to keep the OID reserved until the
     outbound message is acked.  (We need an AckClose!)

     OIDs that are non-negative refer to objects in the oberved domain (the
     domain.  OIDs that are negative refer to objects in the observing
     domain.

   Slot Lifetime: As with OIDs, each agent maintains its own namespace.
     Slots are allocated before being sent in Open, and released when an
     AckClose is received.  (In an MT system, even when a Close is sent
     before an Open, the Open might be processed before the Close is done
     being processed.)

   Message direction: Messages types that reference an observation can be
     classified as "request" or "response" messages.  The initiator of the
     observation is always the sender of requests and the recipient of
     repsonses.

     Slot values refer to slots allocated by the initiator.

   Non-negative OIDs identify recipient-side objects.  Negative OIDs identify
     sender-side objects.


 * message = one of:
       Open      slot oid args    // client
       Update    slot result      // host      (response)
       AckUpdate slot             // client
       Close     slot             // client
       AckClose  slot             // host      (response)
       Error     msg

   Example:

      dbs = Opener.register(credentials, eventSource)

           --> Open 10 0 {"register", credentials, H1=eventSource}
           <-- Update 10 {H1=dbs}
           --> Ack 10
           <-- Watch 20 1 {"getEvent"}
           --> Update 20
           <-- Ack 20

 * Errors

   1. Many transport-level errors should not occur if both agents are
      functioning properly.  These are communicated for diagnostic purposes
      and to be treated as fatal errors (terminating the tunnel) to minimize
      the damage caused by these pathological situations.

   2. Other transport-level "errors" may be used for version
      detection. Future versions of the protocol might add features by
      defining new messages, and "Error msgid" responses can tell one agent
      that the other does not support that feature.

   3. Finally, other exceptional conditions that occur above the transport
      layer can be communicated through it, via Update.  The `result` can
      encode "exceptional" values as well as ordinary values.  (Perhaps the
      aspect of serialization that distinguishes errors is more generic
      (e.g. IDL-independent, lower-level) than the other aspects of
      serialization.

 * Ping: simple payload free call-response message pair can help in
   profiling channel latency and testing liveness.

 * Serialization: ideally and ultimately, C-like data layout with proxies
   (generated from typed interface descriptions) that serialize to (1) an
   array of bytes, and (2) an array of OIDs.

   Initially, however, `args` and `results` convey an array of objects or
   arbitrary JSON-able (non-object) values.  These are serialized as numbers
   (for object values), strings (for strings), or as an array containing a
   single item (any other non-object value).  For example:

       ["f", <object1>, 2, <object3>]  <-->  ["f",1,[2],3]

   Positive OIDs represent target objects, negative ones source objects.

 * Language binding: Objects manifest in different ways in different
   environments.  For example, in a functional reactive environment, an
   object will manifest as a function, and an observation will manifest as a
   live evaluation of a function application.  In a procedural, OO
   environment, an object could manifest as a native object that exposes an
   "observe" method that registers a notification callback, and that
   provides some way to de-register.

 * Constancy: An observation might result in a value that is a constant and
   that does not contain any object references.  In that case, the Update
   message can indicate so, so the observing agent can release any resources
   used to maintain the lifetime of the observation.

 * Language binding: "Pending" vs. "Done value" and from "Error name".

   Agents must be able to reflect pending results in the host environment.
   This will appear, for example, between Open and the first Update
   response.  It should also be possible to chain "Pending" through a
   tunnel, so that the client is not presented with a "Done Pending" value,
   as well as chaining Error values.

 * Agents should "unwrap" proxies to remote objects when sending them to the
   peer domain.

 * When an output value changes, the entirety of the value is transferred
   before observers are notified and the change is made visible.  Observing
   very large values can present latency problems in a networked
   environment.  Because this can also present problems unrelated to
   communication (e.g. memory exhaustion in the client environment), we
   leave this to the application layer to deal with, ultimately. For
   example, a UI displaying a million-row table should only query those rows
   that are visible to the user or nearby.

 * Startup: manifest objects... Some OIDs may be pre-allocated in each
   domain.  The set of objects can vary from domain to domain.

 * Authentication: Authentication can be implemented at the object level.
   An server agent can expose a single manifest object that implement a
   method for authentication:

       o.authenticate : credentials -> obj

   It accepts credentials (a secret key) an returns an object that provides
   access to further functionality.

 * Portable Object References

   It may be desirable to "port" an object reference from one tunnel to
   another.  By this we mean the following: a client that holds a reference
   to a remote object (via an OID that is valid within one tunnel) may wish
   to obtain an OID in a different tunnel (to the same peer domain) that
   references the *same* object.

   This can be the case when, with three interconnected domains -- A <-> B,
   B <-> C, C <-> A -- two domains want to share a reference to the third
   domain without introducing additional forwarding.  An example might be
   when a browser document A spawns another browser document B and wants it
   to access some of the objects held by A without requiring the future
   involvement of A.

   This can be achieved by having the implementing domain provide a service
   that creates an OToken (a long secret ID or "token") for a given OID, and
   also a service that recovers an OID, given an OToken.

     A -> C: open "get OToken of OID" (XID=xa)
       ... A gives B the OToken, along with address of C & credentials ...
       ... B establishes a tunnel to C ...
     B -> C: open "get OID for OToken" (XID=xb)
     A -> C: close XID=xa
       ... A can now disconnect ...
       ... B can use the OID ...
     B -> C: close XID=xb



with the following sequence:

     A->C: Open XID OID "getLongOID"
     C->A: Update XID LONG_OID
     A->C: AckUpdate XID
     B->C: Open XID LONG_OID "getSmallOID"
     C->B: UpdateXID SHORT_OID

     A->C: Close XID


 * Streams: ...

## ROP/Web: Long Polling

Enable ROP between a browser-based client and a web server.  We define HTTP
transactions that send, in the body of the request, client messages, and
receive, in the body of the response, server messages.

Client ID: Since a server can have mutiple clients, we include a client ID
   in each request (a large random number generated by the client).

Sequencing: Due to the nature of networking in general and HTTP in
   particular, we do not rely on individual HTTP transactions to succeed.
   We require positive acknowledgement from the peer before concluding any
   message has been delivered.  The client keeps a counter of *distinct*
   transactions sent, and marks each request with this "sequence number".  A
   response from the server is an acknowlegement of the request.  The client
   also includes in its request an ack of the highest response it saw.
   (This will be N-1 unless we have overlapping transactions...)

Polling: We use long polling (a transaction in which the server's response
   is delayed) to deliver asynch server messages immediately.  As long as
   there are any open observations in the tunnel (or any client-provided
   manifest objects) the client must maintain a pending polling transaction
   in order to await server message, even when it does not have any client
   messages to send.

Retransmit: On timeout or error, the client will retransmit.  This consists
   of issuing a new transaction with exactly the same request data as the
   failed/timed-out transaction (sane sequence number).  If the server sees
   a repeated sequence number (after having processed the client messages),
   it should treat it as a success, and if it had previously responded,
   should send exactly the same response as before.

Overlap: If a client message appears while a long polling request (#N) is
   waiting on a server response, the client sends a new (overlapping!)
   request.  Its sequence number would be N+1, but it will not ack N.  The
   client must then be prepared to retransmit either message.  And the
   server, if it handles N+1 (without ack of N), must be prepared to
   retransmit either response.

   If the client receives a response to N+1 before that of N, it must
   hold that response, retransmit N, and then issue N+2 (acking N+1).

   On receipt of N+1, the server should respond to N.


## ROP/Web: WebSockets

Enable ROP between a browser-based client and a web server, using
WebSockets.

* Client ID
* Group messages into packets
* Sequence numbers for packets (each side)
* Explicit packet ACK


----------------------------------------------------------------

## Terminology


domain: An execution environment that is connected to others via remoting.

agent: A agent is some software that connects a channel to a domain,
   implementing remoting.  (E.g. a JavaScript agent that runs in the browser
   environment, a Rio agent that runs in a Rio environment, a C agent that
   runs on an embedded device, etc.)

tunnel: A tunnel connects two domains, and consists of two agents, one in
  each domain, that communicate with each other by some unspecified channel
  (sockets, etc.).  A system might involve multiple tunnels, connecting
  potentially many domains.

object: An object is a *capability* that exposes functionality to a peer
   in the remoting protocol.

slot: a number identifying an observation.  Each agent allocates its own
   range of values to identify observations it initiates.

TODO

 * Remote Observation Protocol
    - data vs. functions/caps/objects
    - data is transported
    - functions can be called
 * streams
 * chaining Pending and Error
 * chaining constancy (indicate value will not change; e.g. QI)
 * QoS & transport-level semantics
 * Minimize ROP-layer: data = byte array; caps separated
   - JSONFunctions & JSONResults can layer atop
   - Typed proxies can also layer atop
   - Standardized QI will facilitate coexistence of various typing mechanisms
