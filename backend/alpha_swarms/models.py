"""Structured-output schemas for the debate (ARCHITECTURE §7, CONTEXT.md language).

One Thesis schema serves all specialists; the two evidence tiers are a
kind-discriminated union. Tier discipline (numeric for Fundamentals/Technicals,
textual for Sentiment) is enforced by the grounding validator, not the schema —
a wrong-tier citation simply fails to ground.
"""

from typing import Literal

from pydantic import BaseModel, Field

AgentName = Literal["fundamentals", "sentiment", "technicals"]


class NumericEvidence(BaseModel):
    kind: Literal["numeric"] = "numeric"
    claim: str = Field(description="One-sentence factual claim")
    citation_key: str = Field(description="EXACT key from the provided data, e.g. 'income_stmt.Total Revenue'")
    cited_value: float = Field(description="The value at that key, as provided")


class TextualEvidence(BaseModel):
    kind: Literal["textual"] = "textual"
    claim: str = Field(description="One-sentence factual claim")
    source_id: str = Field(description="EXACT source_id of a provided news item")
    quoted_span: str = Field(description="Short verbatim quote copied from that source")


# Smart union, deliberately NOT discriminated: local models often omit the
# `kind` tag, and pydantic can identify the tier from the fields present.
Evidence = NumericEvidence | TextualEvidence


class Thesis(BaseModel):
    stance: float = Field(ge=-1, le=1, description="Signed stance: -1 strong bear ... +1 strong bull")
    summary: str = Field(description="1-2 sentence thesis summary (this is what other agents see)")
    evidence: list[Evidence] = Field(description="Cited evidence backing the stance")


class Attack(BaseModel):
    target: AgentName
    kind: Literal["evidence", "logical"] = Field(
        description="'evidence' = counter-evidence you cite; 'logical' = internal flaw in the thesis")
    critique: str = Field(description="One-sentence statement of the flaw or counter-case")
    counter_evidence: list[Evidence] = Field(
        default_factory=list,
        description="Required for kind='evidence'; cite the provided data exactly")


class RedTeamReport(BaseModel):
    attacks: list[Attack] = Field(description="Strongest attack(s) per target thesis")


class Rebuttal(BaseModel):
    proposed_stance: float = Field(ge=-1, le=1, description="Your stance after weighing the attacks")
    response: str = Field(description="1-2 sentence defence or concession")


class SpecialistRuling(BaseModel):
    agent: AgentName
    adjudicated_stance: float = Field(ge=-1, le=1, description="The specialist's final stance as YOU rule it")
    attacks_landed: list[str] = Field(description="Critiques (verbatim) that genuinely landed; [] if none")
    rationale: str = Field(description="1-2 sentences on how you weighed thesis vs attacks vs rebuttal")


class JudgeRuling(BaseModel):
    rulings: list[SpecialistRuling] = Field(description="Exactly one ruling per debated specialist")
