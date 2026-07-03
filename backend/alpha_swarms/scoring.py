"""The computed Verdict (ADR 0001): pure Python, never authored by the Judge.

Aggregate Stance = plain mean of gated-in specialists' adjudicated stances
(one lens, one equal vote). Direction/Conviction/Dissent are all views of that
single number. Quorum < 2 => No Call.
"""

from statistics import mean

DIRECTION_BAND = 0.25       # |aggregate| <= band => neutral (Refinitiv Hold convention)
HIGH_CONVICTION = 0.75
DISSENT_LOW, DISSENT_MED = 0.5, 1.0  # spread (max-min) band edges
QUORUM = 2


def compute_verdict(adjudicated_stances: dict[str, float]) -> dict:
    """(agent -> adjudicated stance) for VOTING lenses only -> the verdict event."""
    n = len(adjudicated_stances)
    if n < QUORUM:
        return {"type": "verdict", "direction": "no_call", "voting_lenses": n,
                "reason": f"quorum not met (<{QUORUM} grounded lenses, N={n})"}
    stances = list(adjudicated_stances.values())
    aggregate = mean(stances)
    if aggregate > DIRECTION_BAND:
        direction = "bull"
    elif aggregate < -DIRECTION_BAND:
        direction = "bear"
    else:
        direction = "neutral"
    spread = max(stances) - min(stances)
    dissent = "low" if spread < DISSENT_LOW else "med" if spread < DISSENT_MED else "high"
    return {"type": "verdict", "aggregate_stance": round(aggregate, 3), "direction": direction,
            "conviction": round(abs(aggregate), 3), "high_conviction": abs(aggregate) > HIGH_CONVICTION,
            "dissent": dissent, "voting_lenses": n}
