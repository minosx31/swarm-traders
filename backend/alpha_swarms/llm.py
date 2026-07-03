"""Provider abstraction (ADR 0005): one LLM_BACKEND flag picks a LangChain chat model.

Each entry fully specifies provider + model, so switching backends is editing
LLM_BACKEND and restarting — no code change. Never switch mid-run.
"""

import os

BACKENDS = {}  # name -> zero-arg factory; add a line to add a backend


def _ollama():
    from langchain_ollama import ChatOllama

    # PLAN says qwen2.5; the machine currently has qwen3.5:9b pulled — override here.
    return ChatOllama(model=os.environ.get("OLLAMA_MODEL", "qwen3.5:9b"))


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


def system_content(text: str) -> str | list[dict]:
    """System-prompt content with Anthropic cache_control wired from day one.

    On Anthropic backends returns a cache-marked content block (~90% off cached
    input); elsewhere returns the plain string, which every provider accepts.
    Use for system prompts and snapshot slices.
    """
    if current_backend() in ANTHROPIC_BACKENDS:
        return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]
    return text
