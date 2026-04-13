# GOLD Trading Strategy — April 8, 2026
## Multi-Timeframe SMC + LuxAlgo Confluence

**Symbol:** TVC:GOLD (US$/OZ)
**Current Price:** $4,784.63
**Generated:** 2026-04-08 02:55 UTC

---

## 1. MARKET CONTEXT

### Daily (HTF Bias)
- **Structure:** Bullish — consecutive BOS at 4,046 → 4,264 → 4,550 → 5,119
- **Last CHoCH (Daily):** Bearish at 4,841.67 — price is BELOW this level
- **Smart Trail (Daily):** 4,797 — price below trail = short-term weakness
- **Trend Strength (Daily):** 6.67/10 — moderate bullish momentum fading
- **Position:** Price is well ABOVE Daily Equilibrium (4,363-4,481), still in premium territory on the macro
- **100-day range:** Low 3,998 → High 5,598 (+17.12%)

**Daily Verdict:** Macro bullish, but local bearish correction underway. Daily CHoCH at 4,841 is the line in the sand.

### 4H (Execution Timeframe)
- **Structure:** Bearish — CHoCH+ at 4,787, BOS breaks at 4,792 and 4,804
- **Smart Trail (4H):** 4,801 — price below
- **Trend Strength (4H):** 7.05/10 — strengthening bearish
- **Equilibrium:** 4,814-4,818 (above price)
- **Discount Top:** 4,779.82 (price hovering just above)

**4H Verdict:** Sellers in control. Price trapped between discount zone and equilibrium.

---

## 2. KEY LEVELS MAP

```
5,419  ──── 4H R3 (major resistance)
5,212  ──── 4H R2
5,119  ──── Daily BOS (broken support = resistance)
5,030  ──── 4H R1
4,977  ──── OPEN Bearish FVG top  ████ SUPPLY ZONE
4,961  ──── OPEN Bearish FVG bot  ████
4,853  ──── Premium Zone bottom
4,841  ──── Daily CHoCH (CRITICAL)
4,851  ──── 15m R1
4,829  ──── 4H BOS (bulls must reclaim)
4,818  ──── Equilibrium top
4,814  ──── Equilibrium bottom
4,805  ──── CHoCH cluster
4,801  ──── Smart Trail (4H)
4,797  ──── Smart Trail (Daily)
━━━━━━━━━━━━ CURRENT PRICE: 4,784 ━━━━━━━━━━━━
4,779  ──── Discount Top
4,774  ──── CHoCH+ (4H structure)
4,789  ──── 15m S1
4,741  ──── CHoCH (4H)
4,723  ──── OPEN Bullish FVG top  ████ DEMAND ZONE
4,718  ──── OPEN Bullish FVG bot + BOS ████
4,639  ──── 15m S2
4,611  ──── 4H S1
4,553  ──── 4H S2
4,536  ──── Partial Bullish FVG top  ▓▓▓ 62% FILLED
4,524  ──── Partial Bullish FVG bot  ▓▓▓
4,492  ──── 4H S3
```

---

## 3. THE STRATEGY

### SCENARIO A: SHORT (Primary — aligned with 4H trend)

**Thesis:** 4H structure is bearish (CHoCH+ confirmed). Price is below Smart Trail on both 4H and Daily. Target the open bullish FVG below as a magnet.

**Entry Conditions (ALL must be true):**
1. Price retraces UP to 4,800-4,818 zone (Smart Trail + Equilibrium area)
2. LuxAlgo fires a **Bearish** or **Bearish+** signal on 4H
3. OR price prints a bearish engulfing / rejection wick at the zone
4. 4H candle closes BELOW 4,801 (Smart Trail) after touching the zone

**Entry:** $4,800 - $4,815 (sell limit zone)
**Stop Loss:** $4,835 (above 4H BOS at 4,829 + buffer)
**Risk:** ~$35-50 per oz

**Targets:**
| Target | Price | R:R | Reasoning |
|--------|-------|-----|-----------|
| TP1 | $4,741 | 1.5:1 | 4H CHoCH level |
| TP2 | $4,718 | 2.0:1 | Open Bullish FVG + BOS confluence |
| TP3 | $4,639 | 3.5:1 | 15m S2 |
| TP4 | $4,611 | 4.0:1 | 4H S1 major support |

**Management:**
- Move SL to breakeven at TP1
- Take 40% off at TP1, 30% at TP2, 20% at TP3, 10% runner to TP4
- If price breaks ABOVE 4,829 on 4H close → EXIT immediately (structure flip)

---

### SCENARIO B: LONG (Counter-trend — only at deep discount)

**Thesis:** If price drops into the open bullish FVG (4,718-4,723) where a 4H BOS aligns, expect a reaction. Daily structure is still macro bullish.

**Entry Conditions (ALL must be true):**
1. Price taps into the FVG zone 4,715-4,725
2. LuxAlgo fires a **Bullish** or **Bullish+** signal on 15min or 4H
3. OR price prints bullish engulfing on 15min at the zone
4. Volume spike on the reversal candle

**Entry:** $4,715 - $4,725 (buy limit zone)
**Stop Loss:** $4,695 (below FVG + BOS with buffer)
**Risk:** ~$25 per oz

**Targets:**
| Target | Price | R:R | Reasoning |
|--------|-------|-----|-----------|
| TP1 | $4,774 | 2.0:1 | CHoCH+ level |
| TP2 | $4,801 | 3.0:1 | Smart Trail reclaim |
| TP3 | $4,841 | 4.5:1 | Daily CHoCH (major) |
| TP4 | $4,961 | 9.5:1 | Open Bearish FVG fill |

**Management:**
- Move SL to breakeven at TP1
- Take 50% off at TP1, 25% at TP2, 15% at TP3, 10% runner to TP4
- If 4H closes below 4,695 → invalidated, do not re-enter

---

### SCENARIO C: BREAKOUT LONG (if bulls reclaim structure)

**Thesis:** If price breaks above 4,829 (last 4H BOS) and the Daily CHoCH at 4,841, structure flips bullish across timeframes. The open bearish FVG at 4,961-4,977 becomes the target.

**Entry Conditions:**
1. 4H candle closes ABOVE 4,841
2. Retest of 4,829-4,841 as support (former resistance)
3. LuxAlgo trend strength rises above 5.0 on 4H
4. Bullish signal fires on pullback

**Entry:** $4,830 - $4,845 (on retest)
**Stop Loss:** $4,805 (below CHoCH cluster)
**Risk:** ~$30 per oz

**Targets:**
| Target | Price | R:R | Reasoning |
|--------|-------|-----|-----------|
| TP1 | $4,961 | 4.0:1 | Open Bearish FVG bottom |
| TP2 | $5,030 | 6.0:1 | 4H R1 |
| TP3 | $5,119 | 9.0:1 | Daily BOS level |

---

## 4. INVALIDATION RULES

| Scenario | Invalidated If |
|----------|---------------|
| Short (A) | 4H closes above 4,835 |
| Long at FVG (B) | 4H closes below 4,695 |
| Breakout Long (C) | 4H closes back below 4,805 after entry |
| ALL scenarios | Major news event (NFP, FOMC, CPI) — stand aside |

---

## 5. RISK MANAGEMENT

Based on rules.json:
- **Max position size:** 2% of portfolio per trade
- **Stop loss:** REQUIRED on every trade
- **Minimum R:R:** 2.0 (all scenarios meet this)
- **Correlation check:** If already short gold via futures/ETF, reduce size by 50%

### Position Sizing Example ($50,000 account)
| Scenario | Risk $ | SL Width | Position Size |
|----------|--------|----------|---------------|
| Short (A) | $1,000 (2%) | $40 | 25 oz |
| Long FVG (B) | $1,000 (2%) | $25 | 40 oz |
| Breakout (C) | $1,000 (2%) | $30 | 33 oz |

---

## 6. PRE-SESSION CHECKLIST

- [ ] Check for FOMC / CPI / NFP / Fed speakers today
- [ ] Check DXY (Dollar Index) direction — inverse correlation with gold
- [ ] Check VIX — elevated VIX = gold safe-haven bid
- [ ] Check US 10Y yield — rising yields = gold headwind
- [ ] Verify no geopolitical escalations driving panic flows
- [ ] Confirm TradingView CDP connection is live

---

## 7. DECISION TREE

```
START → What is price doing?
│
├─ Price at 4,800-4,818 (retracing to Smart Trail/EQ)?
│  └─ Bearish signal fires? → EXECUTE SHORT (Scenario A)
│     └─ No signal? → WAIT. Do not force.
│
├─ Price drops to 4,715-4,725 (Bullish FVG zone)?
│  └─ Bullish signal + volume? → EXECUTE LONG (Scenario B)
│     └─ No reaction? → FVG failed. Stand aside.
│
├─ Price breaks above 4,841 on 4H close?
│  └─ Retests 4,829-4,841 as support? → EXECUTE BREAKOUT LONG (Scenario C)
│     └─ Fails retest? → Fakeout. Stand aside.
│
└─ Price chopping between 4,774-4,801?
   └─ DO NOTHING. Wait for a scenario to trigger.
```

---

## 8. WHAT I'M WATCHING

1. **4,774 CHoCH+ support** — if this breaks on 4H, fast move to 4,718 FVG likely
2. **4,801 Smart Trail** — acting as dynamic resistance. Bulls need to reclaim.
3. **4,841 Daily CHoCH** — THE level. Above = bullish structure restored. Below = correction continues.
4. **4,718-4,723 Bullish FVG** — untouched demand. High-probability bounce zone if reached.
5. **4,961-4,977 Bearish FVG** — untouched supply overhead. Likely rejection if price rallies there.

---

*Strategy generated from LuxAlgo PAC + S&O readings, multi-timeframe market structure analysis, FVG mapping, and S/R confluence. Review and update every 12 hours or on major structure break.*
