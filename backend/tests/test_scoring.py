"""Issue #6 acceptance: the aggregate is deterministic pure Python."""

from alpha_swarms.scoring import compute_verdict


def test_direction_bands():
    assert compute_verdict({"a": 0.5, "b": 0.5})["direction"] == "bull"
    assert compute_verdict({"a": -0.5, "b": -0.5})["direction"] == "bear"
    assert compute_verdict({"a": 0.2, "b": -0.2})["direction"] == "neutral"
    assert compute_verdict({"a": 0.25, "b": 0.25})["direction"] == "neutral"  # band edge inclusive


def test_aggregate_is_plain_mean_and_conviction_its_magnitude():
    v = compute_verdict({"a": 0.4, "b": 0.1, "c": -0.3})
    assert v["aggregate_stance"] == 0.067
    assert v["conviction"] == 0.067
    assert v["voting_lenses"] == 3


def test_high_conviction_flag():
    assert compute_verdict({"a": 0.9, "b": 0.8})["high_conviction"]
    assert not compute_verdict({"a": 0.75, "b": 0.75})["high_conviction"]  # strictly above


def test_dissent_bands():
    assert compute_verdict({"a": 0.5, "b": 0.3})["dissent"] == "low"
    assert compute_verdict({"a": 0.5, "b": -0.3})["dissent"] == "med"
    assert compute_verdict({"a": 0.8, "b": -0.6})["dissent"] == "high"


def test_quorum_not_met_is_no_call_with_reason():
    for stances in ({}, {"a": 0.9}):
        v = compute_verdict(stances)
        assert v["direction"] == "no_call"
        assert "quorum" in v["reason"]
        assert v["voting_lenses"] == len(stances)


def test_verdict_always_carries_n_beside_conviction():
    assert "voting_lenses" in compute_verdict({"a": 0.5, "b": 0.5})
    assert "voting_lenses" in compute_verdict({"a": 0.5})
