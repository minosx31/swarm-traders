"""Provider abstraction (ADR 0005): one LLM_BACKEND flag picks a LangChain chat model.

Each entry fully specifies provider + model, so switching backends is editing
LLM_BACKEND and restarting — no code change. Never switch mid-run.
"""

import os
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


BACKENDS.update(ollama=_ollama, groq=_groq, haiku=_haiku, sonnet=_sonnet)

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


# UI-facing catalog of selectable models. Ollama is asymmetric (many local
# models under one backend); Claude maps each model to its own backend name.
CLAUDE_OPTIONS = [
    {"backend": "haiku", "model": "claude-haiku-4-5", "label": "Claude Haiku 4.5", "paid": True},
    {"backend": "sonnet", "model": "claude-sonnet-5", "label": "Claude Sonnet 5", "paid": True},
]


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


def available_models() -> list[dict]:
    """Selectable (backend, model) options for the UI. Ollama models come from
    the local daemon; the paid Claude options appear ONLY if ANTHROPIC_API_KEY is
    set server-side (the UI still warns + confirms before spending)."""
    options = [{"backend": "ollama", "model": name, "label": name, "paid": False}
               for name in _ollama_installed()]
    if os.environ.get("ANTHROPIC_API_KEY"):
        options += CLAUDE_OPTIONS
    return options
