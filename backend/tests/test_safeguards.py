"""Issue #2 acceptance: provider flag, circuit breaker, cost logger, spend counter."""

import json

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult
from langgraph.graph import END, START, StateGraph

from alpha_swarms.graph import Blackboard
from alpha_swarms.llm import BACKENDS, system_content, validate_backend
from alpha_swarms.runner import stream_run
from alpha_swarms.safeguards import BreakerTripped, RunSafeguards, read_spend, record_spend


def make_fake_model(n: int = 50):
    return GenericFakeChatModel(messages=iter([AIMessage(content="ok")] * n))


# --- circuit breaker ---------------------------------------------------------


def test_breaker_trips_at_cap():
    handler = RunSafeguards(max_calls=3)
    model = make_fake_model()
    for _ in range(3):
        model.invoke("hi", config={"callbacks": [handler]})
    with pytest.raises(BreakerTripped):
        model.invoke("hi", config={"callbacks": [handler]})
    assert handler.calls == 4


async def test_breaker_cannot_be_bypassed_by_node_code():
    """Handler rides the graph-invoke config; a node calling a model WITHOUT
    passing config/callbacks still gets counted (contextvar propagation)."""
    model = make_fake_model()

    async def chatty(state: Blackboard, config) -> dict:
        for _ in range(10):  # node never touches the handler
            await model.ainvoke("hi")
        return {}

    g = StateGraph(Blackboard)
    g.add_node("chatty", chatty)
    g.add_edge(START, "chatty")
    g.add_edge("chatty", END)

    handler = RunSafeguards(max_calls=4)
    state = {"ticker": "T", "as_of": "d", "theses": [], "attacks": [],
             "rebuttals": [], "adjudicated_stances": []}
    with pytest.raises(BreakerTripped):
        await g.compile().ainvoke(
            state, config={"configurable": {"emit": None}, "callbacks": [handler]}
        )
    assert handler.calls == 5


async def test_tripped_breaker_reaches_sse_client_as_terminal_error_event():
    model = make_fake_model()

    async def runaway(state: Blackboard, config) -> dict:
        while True:  # runaway tool loop — only the breaker stops it
            await model.ainvoke("hi")

    g = StateGraph(Blackboard)
    g.add_node("runaway", runaway)
    g.add_edge(START, "runaway")
    g.add_edge("runaway", END)

    events = [e async for e in stream_run("NVDA", "2026-06-30", graph=g.compile(), delay=0)]
    assert events[-1]["type"] == "error"
    assert events[-1]["error"] == "BreakerTripped"


# --- cost logger + spend counter ----------------------------------------------


def _llm_result(model_name: str, input_tokens: int, output_tokens: int,
                cache_read: int = 0, cache_creation: int = 0) -> LLMResult:
    msg = AIMessage(
        content="ok",
        usage_metadata={
            "input_tokens": input_tokens, "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
            "input_token_details": {"cache_read": cache_read, "cache_creation": cache_creation},
        },
        response_metadata={"model_name": model_name},
    )
    return LLMResult(generations=[[ChatGeneration(message=msg)]])


def test_cost_accumulates_with_cache_accounting():
    handler = RunSafeguards()
    # 10k fresh in, 1k out, 90k cache read, 20k cache write on sonnet pricing
    handler.on_llm_end(_llm_result("claude-sonnet-5", 120_000, 1_000,
                                   cache_read=90_000, cache_creation=20_000))
    expected = (10_000 * 3 + 1_000 * 15 + 20_000 * 3.75 + 90_000 * 0.30) / 1e6
    assert handler.cost_usd == pytest.approx(expected)
    assert handler.tokens["cache_read"] == 90_000


def test_local_models_cost_zero():
    handler = RunSafeguards()
    handler.on_llm_end(_llm_result("qwen3.5:9b", 50_000, 5_000))
    assert handler.cost_usd == 0.0
    assert handler.tokens["output"] == 5_000


def test_openrouter_runs_priced_from_catalog(monkeypatch):
    """OpenRouter runs record a real cost (not $0): priced from the live catalog
    against the model pinned for the run, off real token counts."""
    from alpha_swarms import llm

    monkeypatch.setattr(llm, "_openrouter_pricing",
                        lambda: {"openai/gpt-4o-mini": (1e-6, 2e-6)})  # $1/$2 per Mtok
    llm.set_run_override("openrouter", "openai/gpt-4o-mini")
    try:
        handler = RunSafeguards()
        # the OpenRouter response reports a bare model name; pricing keys off the pin
        handler.on_llm_end(_llm_result("gpt-4o-mini", 50_000, 5_000))
        assert handler.cost_usd == pytest.approx((50_000 * 1 + 5_000 * 2) / 1e6)
    finally:
        llm.set_run_override(None, None)


def test_global_spend_counter_persists_across_runs(tmp_path, monkeypatch):
    monkeypatch.setenv("SPEND_FILE", str(tmp_path / "spend.json"))
    assert read_spend() == 0.0
    record_spend(0.5)
    record_spend(0.25)
    assert read_spend() == pytest.approx(0.75)
    assert json.loads((tmp_path / "spend.json").read_text())["total_usd"] == pytest.approx(0.75)


# --- backend selection ----------------------------------------------------------


def test_all_planned_backends_registered():
    assert set(BACKENDS) == {"ollama", "openrouter", "groq", "haiku", "sonnet"}


def test_unknown_backend_fails_fast(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "gpt5")
    with pytest.raises(RuntimeError, match="not set to a valid backend"):
        validate_backend()


def test_unset_backend_fails_fast(monkeypatch):
    # the mock-phase allowance for an unset backend ended at #4: the real graph
    # needs a backend, so startup refuses rather than erroring mid-run
    monkeypatch.delenv("LLM_BACKEND", raising=False)
    with pytest.raises(RuntimeError, match="not set to a valid backend"):
        validate_backend()


def test_cache_control_only_on_anthropic_backends(monkeypatch):
    monkeypatch.setenv("LLM_BACKEND", "sonnet")
    block = system_content("you are an analyst")
    assert block == [{"type": "text", "text": "you are an analyst",
                      "cache_control": {"type": "ephemeral"}}]
    monkeypatch.setenv("LLM_BACKEND", "ollama")
    assert system_content("you are an analyst") == "you are an analyst"
