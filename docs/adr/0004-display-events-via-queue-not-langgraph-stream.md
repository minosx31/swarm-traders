# Display events flow through an explicit queue, not LangGraph's stream

**Status:** accepted

The live-debate SSE feed is emitted by node code into an explicit per-run
`asyncio.Queue`, drained by the `/stream` endpoint — *not* derived from
LangGraph's `.stream()`/`astream()`. LangGraph is still the orchestrator (it runs
the fixed debate sequence, fans out the specialists, waits on the fan-in, and
merges the blackboard). It just does not author the wire events. Recording a run
is dumping the queue's event log; replay re-drains that log through the same
endpoint with the graph bypassed.

## Why

The SSE contract (ARCHITECTURE §3) has seven event types, and several are
*intra-node*: `agent_start` fires before a node returns, and `tool_call` /
`tool_result` fire mid-node during a rebuttal or red-team turn — precisely the
agentic visuals ADR 0003 is built to showcase. LangGraph's `stream_mode="updates"`
yields exactly one dict *per node, after it finishes*, so it can produce only the
"after" events. It structurally cannot emit `agent_start` or the tool events.

Something has to carry those intra-node events. An explicit queue lets node code
emit our exact contract directly, keeps the wire format decoupled from LangGraph
internals, gives us control over event ordering and the deliberate inter-event
delay, and makes replay fall out for free (record = persist the queue; replay =
re-drain it). This does mean LangGraph's headline selling point — "`.stream()`
gives SSE for free" — is not why we keep it; the orchestration (fan-out, fan-in
wait, reducer-merged blackboard) is. That is a smaller benefit than first
advertised, but a real one, and cheaper than hand-rolling `asyncio.gather` plus
manual concurrent-state merging for a graph we still expect to grow.

## Consequences

- Nodes take an `emit()` helper (a queue writer) alongside their state I/O; every
  node both returns a partial state update *to LangGraph* and emits display events
  *to the queue*. The two channels are independent.
- The `/stream` endpoint owns the queue lifecycle and is the single catch point
  for a run that raises mid-graph (e.g. the circuit breaker, ADR 0005) — it emits
  a terminal `error` event so the UI degrades instead of the socket dying.
- Replay mode and the terminal pretty-printer both consume the same recorded event
  log, so the fallback ladder (React lanes → terminal → replay) needs no second
  integration.

## Rejected

- **`astream_events(version="v2")`:** emits intra-node events without hand-written
  `emit()` calls, but couples our wire format to LangGraph's internal event names
  and payloads (which shift across versions) and forces a noisy filter/translate
  layer. Recording a run would persist LangGraph's internal stream, which is
  messier to pin down for replay.
- **Drop LangGraph for plain `asyncio`:** viable for today's fixed linear graph
  (~40 lines of `gather`), but gives up fan-in waiting, reducer-merged state, and
  the legibility of "built on LangGraph" at an agentic hackathon — for little
  saving once the queue already carries the events.
