"""Non-negotiable budget safeguards (PLAN, ADR 0005), built before any agent.

One LangChain BaseCallbackHandler per run, attached globally via the graph
invoke's config — node code cannot bypass it. on_chat_model_start counts calls
and raises BreakerTripped past max_calls; on_llm_end accumulates estimated cost
(including Anthropic cache_read/cache_creation tokens) and per-run totals are
folded into a persistent global spend counter.
"""

import json
import os
from pathlib import Path
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

MAX_CALLS_PER_RUN = 20  # backstop above a full tool run's worst case: 3 specialists
# (≤2 each) + red-team (≤3) + 3 rebuttals (≤3 each) + judge = ≤19. Pre-sliced is 8.

# $ per M tokens, matched by model-name prefix: (input, output, cache_write, cache_read)
# Non-Anthropic backends (ollama, groq free tier) fall through to $0.
PRICES_PER_MTOK = {
    "claude-sonnet": (3.0, 15.0, 3.75, 0.30),
    "claude-haiku": (1.0, 5.0, 1.25, 0.10),
    "claude-opus": (5.0, 25.0, 6.25, 0.50),
}


class BreakerTripped(RuntimeError):
    """Raised when a run exceeds MAX_CALLS_PER_RUN LLM calls."""


def _price_for(model_name: str):
    for prefix, prices in PRICES_PER_MTOK.items():
        if model_name.startswith(prefix):
            return prices
    return (0.0, 0.0, 0.0, 0.0)


class RunSafeguards(BaseCallbackHandler):
    """Circuit breaker + cost logger for a single run."""

    raise_error = True  # REQUIRED: LangChain swallows handler exceptions otherwise

    def __init__(self, max_calls: int = MAX_CALLS_PER_RUN) -> None:
        self.max_calls = max_calls
        self.calls = 0
        self.cost_usd = 0.0
        self.tokens = {"input": 0, "output": 0, "cache_read": 0, "cache_creation": 0}

    def _count_call(self) -> None:
        self.calls += 1
        if self.calls > self.max_calls:
            raise BreakerTripped(
                f"circuit breaker: run exceeded {self.max_calls} LLM calls — killed"
            )

    def on_chat_model_start(self, serialized, messages, **kwargs: Any) -> None:
        self._count_call()

    def on_llm_start(self, serialized, prompts, **kwargs: Any) -> None:
        self._count_call()

    def on_llm_end(self, response, **kwargs: Any) -> None:
        for generations in response.generations:
            for gen in generations:
                message = getattr(gen, "message", None)
                usage = getattr(message, "usage_metadata", None)
                if not usage:
                    continue
                details = usage.get("input_token_details") or {}
                cache_read = details.get("cache_read", 0)
                cache_creation = details.get("cache_creation", 0)
                fresh_input = usage.get("input_tokens", 0) - cache_read - cache_creation
                output = usage.get("output_tokens", 0)

                meta = getattr(message, "response_metadata", {}) or {}
                model = meta.get("model_name") or meta.get("model") or ""
                p_in, p_out, p_write, p_read = _price_for(model)

                self.cost_usd += (
                    fresh_input * p_in + output * p_out
                    + cache_creation * p_write + cache_read * p_read
                ) / 1e6
                self.tokens["input"] += fresh_input
                self.tokens["output"] += output
                self.tokens["cache_read"] += cache_read
                self.tokens["cache_creation"] += cache_creation

    def usage(self) -> dict:
        """Per-run usage snapshot for persistence/comparison: call count, token
        breakdown, and estimated cost ($0 on unpriced backends like Ollama, but
        the token counts are still real)."""
        return {
            "llm_calls": self.calls,
            "cost_usd": round(self.cost_usd, 6),
            "tokens": dict(self.tokens),
        }

    def finish_run(self) -> None:
        """Print the per-run estimate and fold it into the global spend counter."""
        if self.calls == 0:
            return
        total = record_spend(self.cost_usd)
        t = self.tokens
        print(
            f"[cost] {self.calls} LLM calls · est ${self.cost_usd:.4f} "
            f"(in={t['input']} out={t['output']} "
            f"cache_read={t['cache_read']} cache_creation={t['cache_creation']}) "
            f"· global spend ${total:.4f}",
            flush=True,  # survives redirected stdout + SIGTERM shutdown
        )


def _spend_file() -> Path:
    return Path(os.environ.get("SPEND_FILE", Path(__file__).parent.parent / "data" / "spend.json"))


def read_spend() -> float:
    path = _spend_file()
    if path.exists():
        return json.loads(path.read_text())["total_usd"]
    return 0.0


def record_spend(cost_usd: float) -> float:
    """Add one run's cost to the persistent counter; return the new total."""
    path = _spend_file()
    total = read_spend() + cost_usd
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"total_usd": total}))
    return total
