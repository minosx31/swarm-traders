# Data Sources — Reliability & Credibility Q&A Prep

Prep for judge/reviewer questions about where Alpha Swarms gets its data and
whether that data is trustworthy. Read the [TL;DR](#tldr) first, then the
[Q&A bank](#qa-bank). The [source landscape](#appendix-source-landscape) at the
end is reference material, not something to recite.

---

## TL;DR

**What we run today**

| Data | Current source | What it is |
|---|---|---|
| Prices (OHLCV) | `yfinance` | Unofficial scraper of Yahoo Finance's front-end endpoints |
| Fundamentals | **SEC EDGAR** (US) → `yfinance` fallback | As-reported figures stamped with the real 10-Q/10-K filing date; yfinance only for non-US tickers |
| News | **Finnhub** `company-news` (date-ranged), `yfinance` fallback | Licensed API with a real historical, date-bounded endpoint |

Every snapshot records a `provenance` block naming the source per data type, e.g.
`{"prices": "yfinance", "fundamentals": "sec-edgar", "news": "finnhub"}`.

**The honest self-assessment (say this before they ask):**

1. **The real credibility bar for this system is not "best price feed" — it is
   point-in-time integrity.** Our demo is "run as of the day before the
   catalyst, then reveal what happened." That is only believable if the swarm
   *provably* could not see the future. Our architecture ([ADR 0002](adr/0002-point-in-time-integrity.md))
   enforces this in code: every datum carries an `available_at` date, every read
   tool re-applies the As-Of filter *inside the tool*, and the snapshot save step
   **refuses to persist a leaky snapshot**. Leakage is prevented by construction,
   not by prompt. **This is our strongest answer — lead with it.**

2. **US fundamentals now come straight from SEC EDGAR — the authoritative source.**
   We pull as-reported figures from SEC XBRL (`companyfacts`) and stamp their
   `available_at` with the **actual 10-Q/10-K filing date**, not a guess. We take
   the value from the *earliest* filing for a period, so it is the originally
   reported number, not a later restatement — true point-in-time. The As-Of gate is
   applied at the source (only facts `filed <= As-Of` are eligible). **This closes
   the sharpest fundamentals critique — lead with it after the integrity story.**

3. **`yfinance` remains only for prices (and non-US fundamentals) — we know it is
   the weakest link.** It is an unofficial scraper, not a licensed feed: Yahoo's API
   terms are personal/non-commercial, the library is not endorsed by Yahoo, and it
   can break without warning. Contained because we fetch offline once into a cached
   snapshot, so it never touches a live demo. The licensed-price swap (Tiingo /
   Polygon / EODHD) is a drop-in at one seam — see [Q7](#q7-if-you-had-budget-what-would-production-look-like).

4. **EDGAR is US-only.** SGX / other-market tickers have no SEC filings, so their
   fundamentals gracefully fall back to the yfinance path (provenance records this
   honestly). Cross-market as-reported data is the paid-vendor upgrade (EODHD global,
   or Sharadar/Compustat for institutional PIT).

**The one-line pitch:** *"Fundamentals integrity is now airtight and authoritative —
SEC-sourced, as-reported, real filing dates. The remaining vendor gaps (licensed
prices, non-US fundamentals) are a deliberate hackathon-cost tradeoff with a clear,
costed upgrade path at one code seam."*

---

## Q&A bank

### Q1. "Are your data sources reliable?"

Split the answer:

- **News: yes — Finnhub is a licensed API** with a genuine date-ranged historical
  endpoint (`/company-news?from=…&to=…`), which is exactly what a point-in-time
  system needs. Free tier is generous (60 req/min).
- **US fundamentals: yes — SEC EDGAR is the authoritative primary source.** As-reported
  figures with the real filing date; nothing more credible exists.
- **Prices (and non-US fundamentals): reliable *enough for a curated offline demo*,
  not production-grade.** We pull them via `yfinance` once, at snapshot-build time,
  offline — never live during a run. So the flakiness of a scraper never touches a
  live demo: if Yahoo changed its schema tomorrow, our cached snapshots are
  unaffected. The reliability risk is bounded to "can we rebuild snapshots," not
  "will the demo break."

### Q2. "Why `yfinance`? Isn't that just scraping Yahoo?"

We use it only for **prices** (and non-US fundamentals) — US fundamentals moved to
SEC EDGAR. For prices it was the fastest path to *point-in-time-shaped* dated OHLCV
bars for a one-week build, at $0. We're upfront about the tradeoffs:

- **License:** Yahoo's terms are personal/non-commercial; `yfinance` is unofficial
  and unaffiliated. Acceptable for a research demo, **not** for a commercial
  product — we would not ship this for prices.
- **Stability:** it can break when Yahoo changes their front-end. We contain that
  by fetching offline into a cached snapshot, so a break blocks *rebuilding*, not
  *demoing*.
- **The upgrade is a drop-in at one seam.** All fetching lives in
  `backend/alpha_swarms/ingest.py` behind `fetch_prices` / `fetch_fundamentals` —
  exactly how we already slotted SEC EDGAR in front of the yfinance fundamentals
  path. Swapping prices to a licensed vendor (Tiingo, Polygon, EODHD, FMP) is a
  change to those functions only — the snapshot schema, the As-Of filters, and the
  whole agent stack are untouched.

### Q3. "How do you know you aren't leaking future data into the model?" *(the important one)*

This is where we are strong. Three independent guards:

1. **Every datum is stamped with an `available_at` date** at ingest — prices by
   bar date, news by publish date, US fundamentals by their **real SEC filing date**
   (non-US fundamentals fall back to `period_end + FILING_LAG_DAYS`). Only filings
   dated on or before the As-Of Date are ever admitted.
2. **The read tools re-apply the As-Of filter *inside the tool*** (`tools.py`:
   `financials_at`, `prices_at`, `news_at`). The As-Of date is **not** a model
   argument — the agent literally cannot ask for a later date, so it cannot request
   leaked data. Leakage is impossible by construction.
3. **The snapshot save step refuses to persist a leaky snapshot,** and the
   **Outcome** (what actually happened after) is held entirely outside
   agent-visible state — it never enters the blackboard, only the UI reveal after
   the Verdict.

So even a jailbroken agent asking for "tomorrow's price" gets nothing: the data
isn't in its reachable state.

### Q4. "But are the *fundamentals* really what was known back then?"

For US tickers, **yes — and it's implemented, not aspirational.** We source
fundamentals directly from **SEC EDGAR** (`data.sec.gov` XBRL `companyfacts`):

- **Real filing dates, not a guess.** `available_at` is the actual 10-Q/10-K filing
  date. (Example: Apple's quarter ending 2026-03-28 was *filed* 2026-05-01 — EDGAR
  gives that exact date; the old `period_end + 45d` heuristic would have said 2026-05-12
  and wrongly withheld an already-public quarter.)
- **As-reported values.** EDGAR retains every original filing, so for each line item we
  take the value from the *earliest* filing for that period — the originally reported
  number, before any later restatement.
- **The As-Of gate is applied at the source.** Only facts `filed <= As-Of` are eligible,
  so a not-yet-filed quarter is impossible by construction, and we pick the correct
  quarterly figure (shortest-duration fact, not the YTD roll-up).

This is what a paid point-in-time vendor (Sharadar, Compustat PIT) sells — we get it
free from the primary regulator for US names.

**Remaining gap (state it):** EDGAR is **US-only**. SGX / other-market fundamentals fall
back to the yfinance restated-latest + filing-lag heuristic (provenance records which
path was used). The cross-market fix is a paid vendor — **EODHD** (global) for breadth,
or **Sharadar / S&P Compustat Point-in-Time** for institutional-grade as-reported PIT.

### Q5. "Where does the news come from — is it credible? Do you use Reuters?"

Today: **Finnhub company-news**, which aggregates from licensed publishers with
real publish timestamps (essential for our point-in-time filter). We are not
pulling raw Reuters wire today. Credible upgrades if newswire provenance matters:

- **Benzinga News API** — fintech/brokerage-grade newswire, real-time + historical,
  widely used in production trading apps.
- **Reuters / Dow Jones (Factiva)** — the actual wires; institutional licensing,
  the credibility ceiling, priced accordingly.
- For breadth/research: **NewsAPI**, **Finage** (10+ yr archive), or **GDELT** (free,
  global, good for event coverage; noisier).

The point-in-time property matters more than the brand here: we need an accurate
*publish timestamp* to avoid look-ahead bias, and Finnhub gives us that.

### Q6. "What about Singapore / SGX stocks? And other markets?"

SGX is genuinely thinner in the cheap-API tier, so name the real options:

- **EODHD** — covers SGX (`.SG` suffix), 60+ exchanges, 30+ yr history, prices +
  fundamentals. Best value-for-coverage for going global cheaply.
- **Twelve Data** — SGX (exchange `XSES`), 100k+ instruments across 120+ countries,
  clean multi-asset time series.
- **Financial Modeling Prep (FMP)** — broad global prices + fundamentals + filings
  in one API.
- **Official / institutional for SG:** SGX's own Data & Connectivity feeds
  (historical prices, corporate actions, financial statements), **LSEG/Refinitiv**
  (bundles Reuters news + SGX company data), and **ICE** — the credible route if a
  judge pushes on "official SG data."

**Coverage-by-market reality:** US is *abundant* (dozens of quality vendors); SG is
*served but thinner* (EODHD / Twelve Data / FMP for cheap, LSEG / SGX-direct for
institutional); other developed markets (EU, HK, JP, AU) are well covered by EODHD
and Twelve Data. Emerging markets get sparse below the Bloomberg/LSEG tier.

### Q7. "If you had budget, what would production look like?"

A clean three-tier answer:

| Tier | Prices | Fundamentals | News |
|---|---|---|---|
| **Demo (today, $0)** | yfinance | **SEC EDGAR (US, as-reported, real filing dates)** → yfinance fallback (non-US) | Finnhub |
| **Credible upgrade ($10–200/mo)** | Tiingo / Polygon (US), EODHD / Twelve Data (global + SG) | EDGAR (US) + Sharadar / EODHD (global) | Benzinga / Finnhub |
| **Institutional** | LSEG, Bloomberg, ICE, Databento | Compustat Point-in-Time, FactSet | Reuters, Dow Jones/Factiva |

The architecture doesn't change across tiers — only the `ingest.py` fetch
functions do. That's the design payoff of caching everything into a point-in-time
snapshot behind a whitelist ([ADR 0002](adr/0002-point-in-time-integrity.md),
[ADR 0003](adr/0003-tools-over-cached-data-scoped-to-debate.md)).

### Q8. "Could you just live-fetch for any ticker the user types?"

Deliberately no. Live-fetching would (a) **leak future data** — news APIs return
post-date headlines, "latest" financials silently include the unreported quarter —
and (b) burn unbudgeted API credits mid-demo. We back the open ticker+date input
with a **whitelist**; an uncached name is refused, never live-fetched. Arbitrary
live input is explicitly "what we'd scale to *with* a point-in-time data vendor,"
not something we fake now.

---

## Pricing — if we productionize

All figures are list/observed rates seen mid-2026 in USD. Developer-tier prices are
public; **institutional prices are almost never published** ("contact sales") — the
numbers below come from procurement-data aggregators (Vendr, Costbench) and should be
treated as *negotiation ballparks*, not quotes. Institutional contracts typically
carry **1–2 year minimums** and per-seat pricing.

### Developer / self-serve tier (what we'd actually start on)

| Vendor | Role for us | Public pricing |
|---|---|---|
| **Finnhub** *(current news)* | News + fundamentals | Free (60 req/min); paid ~**$50–$200/mo** (US → global) |
| **Alpha Vantage** | Fundamentals + indicators | Free (~25 req/day); Standard **$49.99**, Premium **$99.99**, Enterprise **$249.99**/mo |
| **Tiingo** | US EOD prices + fundamentals | From **~$10/mo** |
| **Polygon.io** | US prices/options, streaming | From **~$29/mo**, scaling to **$199+/mo** |
| **EODHD** | Global prices + fundamentals, **incl. SGX** | Personal $19.99–$99.99/mo; **Commercial: Internal-Use $399/mo, Enterprise $2,499/mo**, + custom |
| **Twelve Data / FMP** | Global multi-asset, incl. SGX | Free tiers; paid roughly **~$29–$79/mo** |

**Realistic starting bundle:** EODHD All-In-One or its commercial Internal-Use tier
(global + SGX, prices + fundamentals) **+** Finnhub (news) lands the whole system in
the **~$100–$400/mo** range — the pragmatic v1.

### Point-in-time fundamentals (the correct fix for Q4)

| Vendor | Coverage | Pricing |
|---|---|---|
| **Sharadar** (via Nasdaq Data Link) | **US only**, true PIT | Non-professional low-$100s/mo; professional/redistribution higher (via Nasdaq Data Link; historically ~$50→$500/mo by use class, now custom) |
| **S&P Compustat Point-in-Time** | Global, PIT since 1987 | Enterprise-only — bundled into Capital IQ, see below |

### Institutional / enterprise tier (the credibility ceiling)

| Vendor | What it buys | Ballpark annual cost |
|---|---|---|
| **S&P Capital IQ / Compustat** | PIT fundamentals + terminal | **~$10k–$50k+/user/yr**; org contracts observed **$14.8k–$215k**, median ~**$53k/yr** |
| **FactSet** | Fundamentals + analytics, modular | **$4k (basic) → $12k (standard) → $24k–$50k+ (premium)** per user/yr; ~30–50% under Bloomberg |
| **LSEG / Refinitiv (Workspace)** | Reuters news + global + SGX | Single seat **~$22k/yr** (stripped ~$3.6k); mid-market 10–25 seats **$150k–$400k/yr** ACV |
| **Bloomberg Terminal** | The benchmark | **$31,980/yr per seat** (multi-seat $28,320); **B-PIPE/SAPI enterprise feeds $50k–$200k+/yr** |
| **Dow Jones Factiva** | Newswire archive | ~**$2,600/yr** (Vendr, basic seat); enterprise custom |
| **Benzinga News API** | Production newswire | Tiered/custom (free basic tier exists) — "customizes to almost any budget" |

**How to frame this in the room:** *"A credible v1 is ~$100–$400/mo on EODHD +
Finnhub. True point-in-time fundamentals start around Sharadar for US at low-$100s/mo.
Full institutional coverage — Capital IQ / LSEG / Bloomberg — is a $30k–$200k+/yr
commitment, which is why serious point-in-time backtesting is a moat, not a weekend
project. Our architecture is already shaped to plug any of these in at one seam."*

---

## Appendix: source landscape

Quick reference. Prices below are list rates seen mid-2026 and move around — treat
as order-of-magnitude.

**Prices / OHLCV**
- **Tiingo** — clean EOD back to 1962, US fundamentals on paid tiers, from ~$10/mo. Great value for backtesting.
- **Polygon.io** — US equities/options/indices, WebSocket streaming, low latency, from ~$29/mo.
- **EODHD** — 60+ global exchanges incl. **SGX**, 30+ yr history, from ~low-$/mo.
- **Twelve Data** — 120+ countries incl. **SGX (XSES)**, multi-asset.
- **Databento** — institutional-grade raw market microstructure (overkill here).

**Fundamentals**
- **SEC EDGAR** *(current, US)* — the primary regulator source; free XBRL API, as-reported values, real filing dates. **US only.**
- **Sharadar (Nasdaq Data Link)** — investment-grade, **true point-in-time**, survivorship-bias-free. **US only.**
- **S&P Compustat Point-in-Time** — institutional gold standard, PIT snapshots since 1987. Enterprise-priced.
- **Financial Modeling Prep** — broad global fundamentals + filings, cheap.
- **Alpha Vantage** — decent US fundamentals + 50+ technical indicators + macro; international fundamentals thinner; official MCP server for LLM use. Free tier is rate-capped (~25 req/day).
- **EODHD** — global fundamentals to match its price coverage.

**News**
- **Finnhub** *(current)* — licensed aggregation, date-ranged historical endpoint, generous free tier.
- **Benzinga** — production fintech/brokerage newswire, real-time + historical.
- **Reuters / Dow Jones (Factiva)** — the wires themselves; institutional licensing, credibility ceiling.
- **NewsAPI / Finage / financelayer** — broad archives, developer-friendly.
- **GDELT** — free, global event data; noisy but useful for coverage breadth.

**Official / institutional (esp. SG + global)**
- **SGX Data & Connectivity** — official SGX historical prices, corporate actions, financial statements.
- **LSEG / Refinitiv** — Reuters news + global + SGX company data, institutional feed handlers.
- **ICE** — SGX + global equities/fixed income, EOD + historical APIs.
- **Bloomberg** — the reference point everyone benchmarks against.

---

## Sources

- [Yahoo Developer API Terms of Use](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html) · [yfinance (PyPI)](https://pypi.org/project/yfinance/) · [Yahoo Finance API guide + alternatives (MarketXLS)](https://marketxls.com/blog/yahoo-finance-api-ultimate-guide)
- [Best Financial Data APIs in 2026 (nb-data)](https://www.nb-data.com/p/best-financial-data-apis-in-2026) · [Financial data API comparison (GitHub)](https://github.com/financialdatanet/financial-data-api-comparison)
- [SEC EDGAR REST APIs (data.sec.gov)](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) · [Sharadar Fundamentals](https://www.sharadar.com/) · [Sharadar on Nasdaq Data Link](https://data.nasdaq.com/databases/SFA) · [S&P Compustat / Fundamental Data (S&P Global)](https://www.spglobal.com/market-intelligence/en/solutions/products/fundamental-data)
- [Alpha Vantage 2026 guide (AlphaLog)](https://alphalog.ai/blog/alphavantage-api-complete-guide) · [Finnhub stock API](https://finnhub.io/finnhub-stock-api-vs-alternatives)
- [EODHD](https://eodhd.com/financial-apis/) · [EODHD — SGX example](https://eodhd.com/financial-summary/SGR.STU) · [Twelve Data — Singapore Exchange (XSES)](https://twelvedata.com/exchanges/XSES)
- [SGX Data & Connectivity — Historical Data](https://www.sgx.com/data-connectivity/historical-data) · [LSEG — Singapore Stock Exchange](https://www.lseg.com/en/data-analytics/financial-data/pricing-and-market-data/equities-market-data/singapore-stock-exchange) · [ICE — SGX](https://developer.ice.com/fixed-income-data-services/catalog/singapore-exchange-sgx)
- [Benzinga APIs](https://www.benzinga.com/apis/) · [Reuters Business & Financial News API](https://rapidapi.com/makingdatameaningful/api/reuters-business-and-financial-news)

**Pricing**
- [Bloomberg Terminal cost 2026 (Costbench)](https://costbench.com/software/financial-data-terminals/bloomberg-terminal/) · [Bloomberg Terminal cost breakdown (Godel)](https://godeldiscount.com/blog/bloomberg-terminal-cost-2026)
- [FactSet cost 2026 (Costbench)](https://costbench.com/software/financial-data-terminals/factset/) · [S&P Capital IQ pricing 2026 (Costbench)](https://costbench.com/software/financial-data-terminals/sp-capital-iq/)
- [LSEG/Refinitiv pricing (Vendr)](https://www.vendr.com/marketplace/refinitiv) · [Dow Jones pricing (Vendr)](https://www.vendr.com/marketplace/dow-jones)
- [Sharadar data pricing (QuantRocket)](https://www.quantrocket.com/pricing/data/sharadar/) · [Sharadar on Nasdaq Data Link](https://data.nasdaq.com/databases/SFA)
- [EODHD vs Tiingo pricing comparison (FindMyMoat)](https://www.findmymoat.com/vs/eodhd-vs-tiingo) · [News API pricing](https://newsapi.org/pricing)
