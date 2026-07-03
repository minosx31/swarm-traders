"""Scripted chat model for LLM-free debate tests.

Routes each call to a FIFO of canned JSON responses by substring-matching the
prompt (role briefs are stable), so parallel fan-out stays deterministic. It is
a real BaseChatModel, so LangChain callbacks fire — the breaker counts these
calls exactly like production ones.
"""

import json

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda

from alpha_swarms.models import Thesis


class ScriptedChatModel(BaseChatModel):
    script: dict[str, list[str]]  # prompt-substring -> FIFO of response strings

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        text = "\n".join(str(m.content) for m in messages)
        for key, queue in self.script.items():  # insertion order: specific keys first
            if key in text:
                assert queue, f"script for {key!r} exhausted"
                return ChatResult(generations=[ChatGeneration(message=AIMessage(content=queue.pop(0)))])
        raise AssertionError(f"no scripted response matches prompt: {text[:200]}...")

    def with_structured_output(self, schema, include_raw=False, **kwargs):
        assert include_raw, "production path always uses include_raw=True"

        def parse(msg):
            try:
                return {"raw": msg, "parsed": schema.model_validate_json(msg.content),
                        "parsing_error": None}
            except Exception as exc:
                return {"raw": msg, "parsed": None, "parsing_error": exc}

        return self | RunnableLambda(parse)

    @property
    def _llm_type(self) -> str:
        return "scripted"


# --- canned payloads (valid against the conftest NVDA snapshot) -----------------

THESIS_FUNDAMENTALS = json.dumps({
    "stance": 0.7, "summary": "Revenue base is solid.",
    "evidence": [{"kind": "numeric", "claim": "Revenue is 1.0",
                  "citation_key": "income_stmt.Total Revenue", "cited_value": 1.0}]})

THESIS_TECHNICALS = json.dumps({
    "stance": -0.4, "summary": "Price sits at its high; extended.",
    "evidence": [{"kind": "numeric", "claim": "Last close 100.5",
                  "citation_key": "technicals.close_latest", "cited_value": 100.5}]})

THESIS_SENTIMENT = json.dumps({
    "stance": 0.3, "summary": "Coverage is constructive.",
    "evidence": [{"kind": "textual", "claim": "Positive headline",
                  "source_id": "news-001", "quoted_span": "t"}]})

THESIS_SENTIMENT_FABRICATED = json.dumps({
    "stance": 0.9, "summary": "Everyone loves it.",
    "evidence": [{"kind": "textual", "claim": "Glowing coverage",
                  "source_id": "news-999", "quoted_span": "to the moon"}]})

RED_TEAM_ALL = json.dumps({"attacks": [
    {"target": "fundamentals", "kind": "evidence", "critique": "Revenue is flat, not growing",
     "counter_evidence": [{"kind": "numeric", "claim": "Revenue only 1.0",
                           "citation_key": "income_stmt.Total Revenue", "cited_value": 1.0}]},
    {"target": "sentiment", "kind": "logical",
     "critique": "One headline is not broad sentiment", "counter_evidence": []},
    {"target": "technicals", "kind": "logical",
     "critique": "Single bar cannot establish a trend", "counter_evidence": []}]})

RED_TEAM_TWO = json.dumps({"attacks": [
    {"target": "fundamentals", "kind": "evidence", "critique": "Revenue is flat, not growing",
     "counter_evidence": [{"kind": "numeric", "claim": "Revenue only 1.0",
                           "citation_key": "income_stmt.Total Revenue", "cited_value": 1.0}]},
    {"target": "technicals", "kind": "logical",
     "critique": "Single bar cannot establish a trend", "counter_evidence": []}]})


def rebuttal(stance: float) -> str:
    return json.dumps({"proposed_stance": stance, "response": "Conceding part of the attack."})


def judge_ruling(stances: dict[str, float]) -> str:
    return json.dumps({"rulings": [
        {"agent": agent, "adjudicated_stance": stance,
         "attacks_landed": ["some critique"], "rationale": "Weighed the exchange."}
        for agent, stance in stances.items()]})


def full_debate_script(sentiment_thesis: str = THESIS_SENTIMENT) -> dict[str, list[str]]:
    """A complete happy-path script; override entries per test."""
    return {
        # rebuttal keys BEFORE specialist keys: rebuttal prompts contain both briefs
        "fundamentals analyst, defending": [rebuttal(0.55)],
        "sentiment analyst, defending": [rebuttal(0.2)],
        "technicals analyst, defending": [rebuttal(-0.35)],
        "fundamentals analyst": [THESIS_FUNDAMENTALS],
        "sentiment analyst": [sentiment_thesis],
        "technicals analyst": [THESIS_TECHNICALS],
        "red-team": [RED_TEAM_ALL],
        "You are the judge": [judge_ruling(
            {"fundamentals": 0.4, "sentiment": 0.1, "technicals": -0.3})],
    }


MALFORMED = "{ not valid json"


def make_thesis(citation_key: str = "income_stmt.Total Revenue", cited_value: float = 1.0,
                stance: float = 0.5) -> str:
    return json.dumps({
        "stance": stance, "summary": "s",
        "evidence": [{"kind": "numeric", "claim": "c",
                      "citation_key": citation_key, "cited_value": cited_value}]})


assert Thesis.model_validate_json(THESIS_FUNDAMENTALS)  # keep payloads honest
