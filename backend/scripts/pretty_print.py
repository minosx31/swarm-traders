"""Terminal pretty-printer: consumes the /stream SSE feed and renders the debate.

Usage:  uv run scripts/pretty_print.py [--ticker NVDA] [--as-of 2026-06-30] [--url http://localhost:8000]
"""

import argparse
import json

import httpx

COLORS = {
    "fundamentals": "\033[36m",   # cyan
    "sentiment": "\033[35m",      # magenta
    "technicals": "\033[33m",     # yellow
    "red_team": "\033[31m",       # red
    "judge": "\033[32m",          # green
}
BOLD, DIM, RESET = "\033[1m", "\033[2m", "\033[0m"


def paint(agent: str) -> str:
    return f"{COLORS.get(agent, '')}{agent:<13}{RESET}"


def render(event: dict) -> None:
    t = event.get("type")
    agent = event.get("agent", "")
    if t == "agent_start":
        print(f"{paint(agent)} {DIM}── takes the floor ──{RESET}")
    elif t == "thesis":
        print(f"{paint(agent)} THESIS  stance={event['stance']:+.2f}")
        for ev in event.get("evidence", []):
            print(f"{'':14}• {ev['claim']}  {DIM}[{ev.get('citation_key') or ev.get('source_id')}]{RESET}")
    elif t == "attack":
        print(f"{paint(agent)} ATTACK → {event['target']}  ({event['kind']}) {event['critique']}")
        for ev in event.get("counter_evidence", []):
            print(f"{'':14}• {ev['claim']}  {DIM}[{ev.get('citation_key') or ev.get('source_id')}]{RESET}")
    elif t == "tool_call":
        print(f"{paint(agent)} {DIM}⚙ {event['tool']}({json.dumps(event['args'])}){RESET}")
    elif t == "tool_result":
        print(f"{paint(agent)} {DIM}⚙ {event['tool']} → {json.dumps(event['data'])}{RESET}")
    elif t == "rebuttal":
        print(f"{paint(agent)} REBUTTAL  proposed_stance={event['proposed_stance']:+.2f}")
    elif t == "adjudication":
        landed = ", ".join(event["attacks_landed"]) or "none landed"
        print(f"{paint('judge')} ADJUDICATES {agent}: stance={event['adjudicated_stance']:+.2f}  ({landed})")
    elif t == "verdict":
        print(f"\n{BOLD}{'═' * 60}{RESET}")
        if event["direction"] == "no_call":
            print(f"{BOLD}VERDICT: NO CALL{RESET} — {event['reason']}")
        else:
            flag = "  ⚑ high-conviction" if event.get("high_conviction") else ""
            print(f"{BOLD}VERDICT: {event['direction'].upper()}{RESET}"
                  f"  aggregate={event['aggregate_stance']:+.2f}"
                  f"  conviction={event['conviction']:.2f} (N={event['voting_lenses']})"
                  f"  dissent={event['dissent']}{flag}")
        print(f"{BOLD}{'═' * 60}{RESET}")
    elif t == "error":
        print(f"\033[41m ERROR \033[0m {event.get('error')}: {event.get('message')}")
    else:
        print(f"{DIM}? {json.dumps(event)}{RESET}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--as-of", default="2026-06-30")
    ap.add_argument("--url", default="http://localhost:8000")
    args = ap.parse_args()

    params = {"ticker": args.ticker, "as_of": args.as_of}
    with httpx.Client(timeout=None) as client:
        with client.stream("GET", f"{args.url}/stream", params=params) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if line.startswith("data:"):
                    render(json.loads(line[len("data:"):].strip()))
    print(f"{DIM}stream closed{RESET}")


if __name__ == "__main__":
    main()
