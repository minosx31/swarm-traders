"""Provider abstraction (ADR 0005): one LLM_BACKEND flag picks a LangChain chat model.

Each entry fully specifies provider + model, so switching backends is editing
LLM_BACKEND and restarting — no code change. Never switch mid-run.
"""

import os
import time
from contextvars import ContextVar

BACKENDS = {}  # name -> factory(model=None); add a line to add a backend

# Per-run (backend, model) override, set by the runner from the request. A
# contextvar so it rides the run's asyncio task into every nested LLM call
# without threading a param through each node. None ⇒ fall back to env.
_run_override: ContextVar[tuple[str, str] | None] = ContextVar("run_override", default=None)


def ollama_model() -> str:
    # qwen2.5 per PLAN: on Ollama 0.30.x it is the family whose `format` JSON
    # grammar is actually enforced (qwen3.5's new engine ignores it and its
    # tool-call template 500s on malformed calls).
    return os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")


def _ollama(model=None):
    from langchain_ollama import ChatOllama

    model = model or ollama_model()
    kwargs = {}
    if model.startswith("qwen3"):
        kwargs["reasoning"] = False  # thinking model — too slow for the dev loop
    # num_ctx: judge prompts exceed Ollama's small default context
    return ChatOllama(model=model, num_ctx=8192, **kwargs)


def _groq(model=None):
    from langchain_groq import ChatGroq

    return ChatGroq(model=model or "llama-3.3-70b-versatile")


def _haiku(model=None):
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model=model or "claude-haiku-4-5")


def _sonnet(model=None):
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model=model or "claude-sonnet-5")


def openrouter_model() -> str:
    return os.environ.get("OPENROUTER_MODEL", "openai/gpt-4o-mini")


def _openrouter(model=None):
    # OpenRouter is an OpenAI-compatible gateway (ADR 0005: asymmetric like ollama —
    # one backend, many models). base_url + key are all ChatOpenAI needs.
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        model=model or openrouter_model(),
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ.get("OPENROUTER_API_KEY"),
    )


BACKENDS.update(ollama=_ollama, groq=_groq, haiku=_haiku, sonnet=_sonnet, openrouter=_openrouter)

ANTHROPIC_BACKENDS = {"haiku", "sonnet"}


def current_backend() -> str | None:
    ov = _run_override.get()
    return ov[0] if ov else os.environ.get("LLM_BACKEND")


def set_run_override(backend: str | None, model: str | None) -> None:
    """Pin (backend, model) for the current run. Does NOT violate ADR 0005's
    'never switch mid-run' — the override is fixed for the run's duration; only
    *between* runs does it change. None clears it → LLM_BACKEND env default."""
    _run_override.set((backend, model) if backend else None)


def _override_model(backend: str) -> str | None:
    ov = _run_override.get()
    return ov[1] if (ov and ov[0] == backend) else None


def model_tag() -> str:
    """Short slug for the model behind a run — embedded in run filenames so a
    tuning sweep's artifacts self-identify. ollama reports its actual model (the
    knob that varies locally); the hosted backends map 1:1 to a model, so the
    backend name is unambiguous. Never contains '_' (the filename field sep)."""
    backend = current_backend() or "none"
    if backend == "ollama":
        return (_override_model("ollama") or ollama_model()).replace(":", "-")
    if backend == "openrouter":
        # OpenRouter ids carry '/' and ':' (e.g. google/gemini-2.0-flash-001) —
        # both would break the filename, so flatten them to '-'.
        return (_override_model("openrouter") or openrouter_model()).replace("/", "-").replace(":", "-")
    return backend


def validate_backend() -> None:
    """Fail fast at startup on an unset or unknown LLM_BACKEND. The real graph
    needs a backend; the mock-phase allowance for unset ended at #4. Catching it
    here turns a mid-run RuntimeError (a wasted recorded run) into a clear refusal
    to start."""
    backend = current_backend()
    if backend not in BACKENDS:
        raise RuntimeError(
            f"LLM_BACKEND={backend!r} is not set to a valid backend — set one of: "
            f"{', '.join(sorted(BACKENDS))}"
        )


def get_chat_model():
    backend = current_backend()
    if backend not in BACKENDS:
        raise RuntimeError(
            f"LLM_BACKEND={backend!r} is not set to a valid backend — "
            f"valid: {', '.join(sorted(BACKENDS))}"
        )
    return BACKENDS[backend](_override_model(backend))


def structured_output_kwargs() -> dict:
    """qwen3.5 on Ollama 0.30.x ignores `format` grammars (silently returns
    prose), so it must use tool calling; qwen2.5 gets grammar-enforced
    json_schema (the library default). Other providers keep their defaults."""
    if current_backend() == "ollama" and (_override_model("ollama") or ollama_model()).startswith("qwen3"):
        return {"method": "function_calling"}
    # OpenRouter fans out to many providers; function_calling is the one
    # structured-output method they all support (json_schema is spotty).
    if current_backend() == "openrouter":
        return {"method": "function_calling"}
    return {}


def system_content(text: str) -> str | list[dict]:
    """System-prompt content with Anthropic cache_control wired from day one.

    On Anthropic backends returns a cache-marked content block (~90% off cached
    input); elsewhere returns the plain string, which every provider accepts.
    Use for system prompts and snapshot slices.
    """
    if current_backend() in ANTHROPIC_BACKENDS:
        return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]
    return text


# UI-facing catalog of selectable models. Ollama and OpenRouter are asymmetric
# (many models under one backend name); Claude maps each model to its own backend.
# `group` is the optgroup label the UI buckets by, so the server owns provider identity.
CLAUDE_OPTIONS = [
    {"backend": "haiku", "model": "claude-haiku-4-5", "label": "Claude Haiku 4.5", "paid": True,
     "group": "Claude · paid · credits"},
    {"backend": "sonnet", "model": "claude-sonnet-5", "label": "Claude Sonnet 5", "paid": True,
     "group": "Claude · paid · credits"},
]

# Curated OpenRouter models in three tiers (asymmetric backend: one name, many
# models). Hardcoded + tool-verified against the live catalog rather than fetched:
# OpenRouter lists 300+ models, most with poor/no tool support, which our submit_*
# loop requires. `paid` drives the UI's ⚠ CREDITS confirm; the $0 tier skips it.
def _openrouter_tier(models, *, paid, group):
    return [{"backend": "openrouter", "paid": paid, "group": group, **m} for m in models]

OPENROUTER_OPTIONS = (
    _openrouter_tier([  # latest flagships — priciest; gated. Ascending by $/1M out.
        {"model": "z-ai/glm-5.2", "label": "GLM 5.2"},
        {"model": "z-ai/glm-5.1", "label": "GLM 5.1"},
        {"model": "moonshotai/kimi-k2.6", "label": "Kimi K2.6"},
        {"model": "moonshotai/kimi-k2.7-code", "label": "Kimi K2.7 Code"},
        {"model": "anthropic/claude-haiku-4.5", "label": "Claude Haiku 4.5"},
        {"model": "openai/gpt-5.6-luna", "label": "GPT-5.6 Luna"},
        {"model": "google/gemini-3.5-flash", "label": "Gemini 3.5 Flash"},
        {"model": "anthropic/claude-sonnet-5", "label": "Claude Sonnet 5"},
        {"model": "anthropic/claude-opus-4.8", "label": "Claude Opus 4.8"},
    ], paid=True, group="OpenRouter · latest · credits")
)


# Typical per-run token footprint, measured from recorded runs (~8 LLM calls,
# ~30k input / ~5k output). Turns a model's $/token unit price into the per-run
# dollar figure shown on the paid-model confirm step — an estimate, not a quote.
TYPICAL_RUN_TOKENS = {"input": 30_000, "output": 5_000}

_OPENROUTER_PRICING_TTL = 3600  # seconds — the live catalog barely moves
_openrouter_pricing_cache: tuple[float, dict[str, tuple[float, float]]] | None = None


def _openrouter_pricing() -> dict[str, tuple[float, float]]:
    """model_id -> (prompt_$/token, completion_$/token) from OpenRouter's live
    catalog (GET /api/v1/models, public — no key). Cached for an hour; returns the
    last good cache (or {}) if the catalog is unreachable, so the UI degrades to
    'estimate unavailable' rather than erroring."""
    global _openrouter_pricing_cache
    import httpx

    now = time.time()
    if _openrouter_pricing_cache and now - _openrouter_pricing_cache[0] < _OPENROUTER_PRICING_TTL:
        return _openrouter_pricing_cache[1]
    try:
        resp = httpx.get("https://openrouter.ai/api/v1/models", timeout=5)
        resp.raise_for_status()
        pricing: dict[str, tuple[float, float]] = {}
        for m in resp.json().get("data", []):
            p = m.get("pricing") or {}
            try:
                pricing[m["id"]] = (float(p["prompt"]), float(p["completion"]))
            except (KeyError, TypeError, ValueError):
                continue  # a model missing per-token pricing just has no estimate
        _openrouter_pricing_cache = (now, pricing)
        return pricing
    except Exception:  # noqa: BLE001 — catalog down ⇒ keep serving models, no estimate
        return _openrouter_pricing_cache[1] if _openrouter_pricing_cache else {}


def estimate_run_cost(backend: str, model: str) -> float | None:
    """Estimated USD for one run of (backend, model), or None when the model is
    unpriced (Ollama) or its price is unknown. OpenRouter prices come from the
    live catalog; Claude-direct from the same table safeguards charges against."""
    ti, to = TYPICAL_RUN_TOKENS["input"], TYPICAL_RUN_TOKENS["output"]
    if backend == "openrouter":
        prices = _openrouter_pricing().get(model)
        if prices is None:
            return None
        prompt, completion = prices  # already $ per token
        return round(ti * prompt + to * completion, 4)
    if backend in ANTHROPIC_BACKENDS:
        from .safeguards import _price_for

        p_in, p_out, _, _ = _price_for(model)
        return round((ti * p_in + to * p_out) / 1e6, 4)
    return None


def _ollama_installed() -> list[str]:
    """Model names from the local Ollama daemon; [] if it is unreachable."""
    import httpx

    host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
    if "://" not in host:
        host = f"http://{host}"
    try:
        resp = httpx.get(f"{host}/api/tags", timeout=3)
        resp.raise_for_status()
        return [m["name"] for m in resp.json().get("models", [])]
    except Exception:  # noqa: BLE001 — daemon down / bad host ⇒ just an empty list
        return []


def catalog() -> list[dict]:
    """The full paid model catalog (Claude + OpenRouter), independent of which API
    keys are set — for the static demo's bundled models.json. Lets the replay
    picker resolve a recorded run's model_tag back to its label/group and render
    the same optgroups as the live picker. No est_cost (that needs a live price
    call, and replay never spends)."""
    return [{**o, "est_cost_usd": None} for o in CLAUDE_OPTIONS + OPENROUTER_OPTIONS]


def available_models() -> list[dict]:
    """Selectable (backend, model) options for the UI. Ollama models come from
    the local daemon; the OpenRouter and Claude options appear ONLY if their
    respective key (OPENROUTER_API_KEY / ANTHROPIC_API_KEY) is set server-side
    (the UI still warns + confirms before spending on either)."""
    options = [{"backend": "ollama", "model": name, "label": name, "paid": False,
                "group": "Ollama · local · free"}
               for name in _ollama_installed()]
    if os.environ.get("OPENROUTER_API_KEY"):
        options += OPENROUTER_OPTIONS
    if os.environ.get("ANTHROPIC_API_KEY"):
        options += CLAUDE_OPTIONS
    # est_cost_usd feeds the ⚠ CREDITS chip + confirm step (null ⇒ 'estimate
    # unavailable'). Priced lazily so a run with only free models makes no network call.
    return [{**o, "est_cost_usd": estimate_run_cost(o["backend"], o["model"]) if o["paid"] else 0.0}
            for o in options]
