"""Issue #5 acceptance: the deterministic grounding validator + gate."""

from datetime import date

from alpha_swarms.grounding import earns_vote, ground_evidence, ground_item
from alpha_swarms.models import NumericEvidence, TextualEvidence
from alpha_swarms.slices import RunContext
from alpha_swarms.snapshot import NewsItem, PriceBar, ReportedFundamentals, Snapshot


def make_ctx() -> RunContext:
    snapshot = Snapshot(
        ticker="TEST", as_of=date(2026, 6, 30),
        prices=[PriceBar(date=date(2026, 6, 29), open=1, high=1, low=1, close=100.0,
                         volume=1000, available_at=date(2026, 6, 29))],
        fundamentals=ReportedFundamentals(period_end=date(2026, 3, 31),
                                          available_at=date(2026, 5, 15),
                                          income_stmt={"Total Revenue": 5.0e9}, balance_sheet={}),
        news=[NewsItem(source_id="n1", title="Margins expand strongly", summary="Good quarter.",
                       published_at=date(2026, 6, 28), available_at=date(2026, 6, 28))],
    )
    return RunContext(snapshot)


def numeric(key: str, value: float) -> NumericEvidence:
    return NumericEvidence(claim="c", citation_key=key, cited_value=value)


def textual(source_id: str, span: str) -> TextualEvidence:
    return TextualEvidence(claim="c", source_id=source_id, quoted_span=span)


def test_valid_numeric_evidence_grounds():
    assert ground_item(numeric("income_stmt.Total Revenue", 5.0e9), make_ctx())["grounded"]


def test_numeric_within_tolerance_grounds():
    assert ground_item(numeric("income_stmt.Total Revenue", 5.04e9), make_ctx())["grounded"]


def test_fabricated_citation_key_is_dropped():
    out = ground_item(numeric("income_stmt.Imaginary Metric", 1.0), make_ctx())
    assert not out["grounded"] and "not in snapshot" in out["reason"]


def test_out_of_tolerance_value_is_dropped():
    out = ground_item(numeric("income_stmt.Total Revenue", 6.0e9), make_ctx())
    assert not out["grounded"] and "!=" in out["reason"]


def test_derived_technicals_keys_are_groundable():
    assert ground_item(numeric("technicals.close_latest", 100.0), make_ctx())["grounded"]


def test_unresolvable_source_id_is_dropped():
    out = ground_item(textual("n999", "anything"), make_ctx())
    assert not out["grounded"] and "not in snapshot" in out["reason"]


def test_exact_quoted_span_earns_verified_badge():
    out = ground_item(textual("n1", "Margins expand"), make_ctx())
    assert out["grounded"] and out["verified_quote"]


def test_inexact_span_is_grounded_but_unverified():
    # source-existence is the gate; the quote badge is only a badge
    out = ground_item(textual("n1", "margins exploded higher"), make_ctx())
    assert out["grounded"] and not out["verified_quote"]


def test_gate_requires_at_least_one_grounded_item():
    ctx = make_ctx()
    _, grounded = ground_evidence([numeric("fake.key", 1.0), textual("n999", "x")], ctx)
    assert not earns_vote(grounded)
    _, grounded = ground_evidence([numeric("fake.key", 1.0), textual("n1", "x")], ctx)
    assert earns_vote(grounded)
