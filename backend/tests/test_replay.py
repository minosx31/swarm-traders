"""Issue #9 acceptance: every run recorded; replay through /stream at zero cost."""

import json

import pytest

from alpha_swarms import llm
from alpha_swarms.app import app
from alpha_swarms.replay import latest_run_path
from alpha_swarms.runner import stream_run
from alpha_swarms.safeguards import RunSafeguards
from tests import fakes
from tests.conftest import WHITELISTED, collect_sse_events


@pytest.fixture(autouse=True)
def runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("RUNS_DIR", str(tmp_path / "runs"))
    return tmp_path / "runs"


@pytest.fixture
def scripted(monkeypatch):
    model = fakes.ScriptedChatModel(script=fakes.full_debate_script())
    monkeypatch.setattr(llm, "get_chat_model", lambda: model)


async def test_every_run_writes_its_full_event_log(scripted):
    live = [e async for e in stream_run(**WHITELISTED, delay=0)]
    path = latest_run_path(**WHITELISTED)
    assert path is not None
    log = json.loads(path.read_text())
    assert log["ticker"] == WHITELISTED["ticker"] and log["as_of"] == WHITELISTED["as_of"]
    assert log["events"] == live  # exactly what went over the wire


async def test_replay_streams_identically_with_zero_llm_calls(scripted):
    live = [e async for e in stream_run(**WHITELISTED, delay=0)]

    def fail():  # replay must never construct a chat model
        raise AssertionError("LLM touched during replay")

    safeguards = RunSafeguards()
    import alpha_swarms.llm as llm_mod
    original = llm_mod.get_chat_model
    llm_mod.get_chat_model = fail
    try:
        status, replayed = await collect_sse_events(app, {**WHITELISTED, "replay": "1"})
    finally:
        llm_mod.get_chat_model = original

    assert status == 200
    assert replayed == live
    assert safeguards.calls == 0  # $0: no calls counted anywhere in replay


async def test_error_events_are_recorded_too(scripted, monkeypatch):
    script = fakes.full_debate_script()
    script["fundamentals analyst"] = [fakes.MALFORMED, fakes.MALFORMED]
    model = fakes.ScriptedChatModel(script=script)
    monkeypatch.setattr(llm, "get_chat_model", lambda: model)

    [e async for e in stream_run(**WHITELISTED, delay=0)]
    log = json.loads(latest_run_path(**WHITELISTED).read_text())
    assert log["events"][-1]["type"] == "error"


async def test_replay_without_recording_is_refused_with_400():
    status, events = await collect_sse_events(app, {**WHITELISTED, "replay": "1"})
    assert status == 400 and events == []
