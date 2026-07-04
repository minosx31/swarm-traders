"""Provider abstraction (ADR 0005): one LLM_BACKEND flag picks a LangChain chat model.

Each entry fully specifies provider + model, so switching backends is editing
LLM_BACKEND and restarting — no code change. Never switch mid-run.
"""

import os

BACKENDS = {}  # name -> zero-arg factory; add a line to add a backend


def ollama_model() -> str:
    # qwen2.5 per PLAN: on Ollama 0.30.x it is the family whose `format` JSON
    # grammar is actually enforced (qwen3.5's new engine ignores it and its
    # tool-call template 500s on malformed calls).
    return os.environ.get("OLLAMA_MODEL", "qwen2.5:7b")


def _ollama():
    from langchain_ollama import ChatOllama

    model = ollama_model()
    kwargs = {}
    if model.startswith("qwen3"):
        kwargs["reasoning"] = False  # thinking model — too slow for the dev loop
    # num_ctx: judge prompts exceed Ollama's small default context
    return ChatOllama(model=model, num_ctx=8192, **kwargs)


def _groq():
    from langchain_groq import ChatGroq

    return ChatGroq(model="llama-3.3-70b-versatile")


def _haiku():
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model="claude-haiku-4-5")


def _sonnet():
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(model="claude-sonnet-5")


BACKENDS.update(ollama=_ollama, groq=_groq, haiku=_haiku, sonnet=_sonnet)

ANTHROPIC_BACKENDS = {"haiku", "sonnet"}


def current_backend() -> str | None:
    return os.environ.get("LLM_BACKEND")


def validate_backend() -> None:
    """Fail fast at startup on an unknown LLM_BACKEND (unset is allowed while
    the graph is still mock — issue #4 makes it required)."""
    backend = current_backend()
    if backend is not None and backend not in BACKENDS:
        raise RuntimeError(
            f"Unknown LLM_BACKEND={backend!r} — valid: {', '.join(sorted(BACKENDS))}"
        )


def get_chat_model():
    backend = current_backend()
    if backend not in BACKENDS:
        raise RuntimeError(
            f"LLM_BACKEND={backend!r} is not set to a valid backend — "
            f"valid: {', '.join(sorted(BACKENDS))}"
        )
    return BACKENDS[backend]()


def structured_output_kwargs() -> dict:
    """qwen3.5 on Ollama 0.30.x ignores `format` grammars (silently returns
    prose), so it must use tool calling; qwen2.5 gets grammar-enforced
    json_schema (the library default). Other providers keep their defaults."""
    if current_backend() == "ollama" and ollama_model().startswith("qwen3"):
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
