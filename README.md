# Claude Trading Bot

Fully automated trading system that connects **Claude Code** to **TradingView Desktop** (via CDP) and **MetaTrader 5** (via file bridge) with **Telegram alerts**.

Reads LuxAlgo indicators in real-time, evaluates multi-timeframe confluence, executes trades on MT5, manages positions with trailing stops, and sends every action to Telegram.

> **This is a personal trading bot running on a demo account. Use at your own risk on live accounts.**

## Architecture

```
Claude Code (scheduler)
    |
    v
TradingView Desktop (CDP port 9222)
    |-- LuxAlgo Signals & Overlays    (Smart Trail, Trend, Buy/Sell signals)
    |-- LuxAlgo Price Action Concepts  (EQ zones, Premium/Discount, BOS/CHoCH)
    |-- LuxAlgo Oscillator Matrix      (HyperWave, Money Flow, Confluence)
    |
    v
scanner_lite.cjs (every 5 min)
    |-- Reads 15min for BIAS (structure, zones)
    |-- Reads 5min for ENTRY (signals, oscillator)
    |-- Calculates confluence score (0-100)
    |-- If score >= 40 + zone match --> EXECUTE
    |
    v
signal.json --> TV.mq5 EA (MT5) --> ack.json
    |                                    |
    v                                    v
Telegram Bot                    Trade executed on MT5
(@gold_alerts_careless_bot)     (SL/TP set, partial close, trailing)
```

## What It Does

| Feature | Description |
|---------|-------------|
| **Dual timeframe scanning** | 15min for bias, 5min for entry triggers |
| **3-indicator confluence** | Scores 0-100 from S&O + PAC + Oscillator Matrix |
| **Auto-execution** | Places trades on MT5 with SL/TP via file bridge |
| **Smart exits** | Oscillator exhaustion, reversal signals, structure flips |
| **Position management** | Partial close at TP1/TP2, trailing stop, SL to breakeven |
| **Telegram alerts** | Entry, exit, TP hit, SL trail, 12hr updates |
| **S/R drawing** | Auto-draws support/resistance and FVG zones on chart |
| **12hr watchlist scan** | Scans BTCUSD, ETHUSD, SOLUSD, AAPL, TSLA, NVDA |

## Prerequisites

- **macOS** (Apple Silicon or Intel)
- **Node.js 18+** (`brew install node`)
- **Git** (`xcode-select --install`)
- **TradingView Desktop** ([download](https://www.tradingview.com/desktop/))
- **MetaTrader 5** ([download](https://www.metatrader5.com/))
- **Claude Code** (CLI or Desktop)
- **LuxAlgo Premium indicators** (Signals & Overlays, Price Action Concepts, Oscillator Matrix)

## Setup

### Step 1: Clone and install

```bash
cd ~
git clone https://github.com/eswarcareless/claude-trading-bot.git tradingview-mcp
cd tradingview-mcp
npm install
```

### Step 2: Configure Claude Code MCP

Create `.mcp.json` in your working directory:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/YOUR_USERNAME/tradingview-mcp/src/server.js"],
      "env": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      }
    }
  }
}
```

Replace `YOUR_USERNAME` with your macOS username (`whoami`).

### Step 3: Launch TradingView with CDP

```bash
# Use the included launch script
~/tradingview-mcp/START.sh

# Or manually:
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222 &
```

Verify CDP is running:
```bash
curl -s http://localhost:9222/json/version
```

### Step 4: Set up TradingView chart

1. Open XAUUSD (or your preferred symbol) chart
2. Add these LuxAlgo indicators:
   - **Signals & Overlays** (provides Smart Trail, trend strength, buy/sell signals)
   - **Price Action Concepts Premium** (provides EQ zones, premium/discount, BOS/CHoCH)
   - **Oscillator Matrix** (provides HyperWave, Money Flow, Confluence Meter)

### Step 5: Set up MetaTrader 5

1. Open MT5 and log into your account
2. Open an **XAUUSD** chart
3. Copy `MQL5/Experts/TV.mq5` to your MT5 Experts folder (or it's already there if you cloned)
4. In MetaEditor: open TV.mq5 and click **Compile**
5. Drag the **TV** EA onto your XAUUSD chart
6. Enable **AutoTrading** (green play button in toolbar)
7. EA settings:
   - `InpSecret`: `test123` (must match alerts/config.json)
   - `InpDefaultLot`: `0.01` (or your preferred size)
   - `InpPollMs`: `100`

The EA reads `MQL5/Files/signal.json` and writes results to `MQL5/Files/ack.json`.

### Step 6: Set up Telegram bot

1. Open Telegram, search **@BotFather**, send `/newbot`
2. Name it and get the **bot token**
3. Start a chat with your bot and send `/start`
4. Get your **chat ID**:
   ```bash
   curl -s "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates" | python3 -c "import sys,json; r=json.load(sys.stdin)['result'][0]; print('Chat ID:', r['message']['chat']['id'])"
   ```
5. Copy the config template and fill in your values:
   ```bash
   cp alerts/config.example.json alerts/config.json
   # Edit alerts/config.json with your bot_token and chat_id
   ```
6. Test:
   ```bash
   node alerts/telegram.cjs test
   ```

### Step 7: Configure auto-trader

Edit `autotrader/config.json` to set your:
- **Symbol and lot size**
- **Entry zones** (short/long entry, SL, TP levels)
- **Risk limits** (max trades/day, max daily loss)
- **Active hours**

Initialize state:
```bash
cp autotrader/state.example.json autotrader/state.json
```

### Step 8: Test with dry run

```bash
node autotrader/scanner_lite.cjs --dry-run
```

You should see it read both timeframes, calculate confluence scores, and report whether conditions are met — without executing any trades.

### Step 9: Go live

In Claude Code, set up the 5-minute cron:

```
# In Claude Code conversation:
"Set up the auto-trader cron every 5 minutes"
```

Or use Claude Code's scheduled tasks:
```
# Creates a persistent scheduled task
node autotrader/scanner_lite.cjs
```

## File Structure

```
tradingview-mcp/
├── src/                      # TradingView MCP server (78 tools)
│   ├── server.js             # MCP stdio server
│   ├── connection.js         # CDP WebSocket connection
│   ├── core/                 # Tool implementations
│   └── tools/                # MCP tool definitions
│
├── autotrader/               # Auto-trading system
│   ├── scanner_lite.cjs      # Main scanner (reads chart, evaluates, executes)
│   ├── config.json           # Strategy config (zones, risk, conditions)
│   ├── state.json            # Runtime state (open positions, daily stats)
│   └── scanner.cjs           # Legacy scanner (heavier, more features)
│
├── alerts/                   # Notification system
│   ├── telegram.cjs          # Telegram bot (entry/exit/TP/SL alerts)
│   ├── mt5.cjs               # MT5 trade executor (Node.js bridge)
│   ├── config.json           # Telegram credentials (gitignored)
│   └── config.example.json   # Template for config.json
│
├── strategies/               # Generated strategy documents
│   └── GOLD_strategy_*.md    # Strategy with entry/exit/management rules
│
├── rules.json                # Watchlist, bias criteria, risk rules
├── CLAUDE.md                 # Instructions for Claude Code sessions
├── START.sh                  # Launch TradingView with CDP
├── run_tool.cjs              # CLI helper to call MCP tools
└── package.json
```

## TV.mq5 EA — Signal Protocol

The MetaTrader 5 Expert Advisor communicates via JSON files:

### Entry (with price-based SL/TP)
```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "ENTRY",
  "direction": "SELL",
  "lot": 0.01,
  "sl_price": 4835,
  "tp_price": 4741,
  "id": "unique-id"
}
```

### Close all positions
```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "CLOSE",
  "id": "unique-id"
}
```

### Partial close (e.g., 40% at TP1)
```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "PARTIAL_CLOSE",
  "percent": 40,
  "id": "unique-id"
}
```

### Modify SL/TP (e.g., move SL to breakeven)
```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "MODIFY",
  "sl_price": 4808,
  "tp_price": 4611,
  "id": "unique-id"
}
```

## Confluence Scoring System

The auto-trader calculates a 0-100 score from 3 LuxAlgo indicators before entering:

| Points | Source | SHORT signal | LONG signal |
|--------|--------|-------------|-------------|
| 10 | Smart Trail (S&O) | Price below trail | Price above trail |
| 5 | Trend Strength (S&O) | > 5 | > 5 |
| 15-20 | Signal (S&O) | Bearish / Bearish+ | Bullish / Bullish+ |
| 15 | EQ Zone (PAC) | Price in equilibrium | Price in equilibrium |
| 10 | Premium/Discount (PAC) | In premium zone | In discount zone |
| 10-15 | HyperWave (Osc) | > 70 overbought | < 30 oversold |
| 10 | Money Flow (Osc) | < 45 outflow | > 55 inflow |
| 10 | Confluence Meter (Osc) | < 40 bearish | > 60 bullish |
| 5 | Overflow (Osc) | Bear > 55 | Bull > 55 |

**Minimum 40/100 required** to trigger a trade. Higher = higher conviction.

## Smart Exit System

| Exit Type | Trigger | Action |
|-----------|---------|--------|
| **TP1 Hit** | Price reaches TP1 | Close 40%, move SL to breakeven |
| **TP2 Hit** | Price reaches TP2 | Close 50% of remaining |
| **Momentum Exhausted** | In profit + exit score >= 50 | Close all (lock profit) |
| **Strong Reversal** | Exit score >= 70 | Close all (limit damage) |
| **Reversal Signal** | In profit + opposite LuxAlgo signal | Close immediately |
| **Structure Flip** | Price crosses Smart Trail + trend < 4 | Emergency close |
| **Trailing Stop** | After TP1, locks 40% of running profit | Auto-adjusts SL |

## Telegram Alert Types

```bash
# Test connection
node alerts/telegram.cjs test

# Trade entry (with chart screenshot)
node alerts/telegram.cjs entry '{"direction":"SHORT","symbol":"GOLD",...}'

# Take profit hit
node alerts/telegram.cjs tp '{"tpLevel":"TP1","tpPrice":"4741",...}'

# Stop loss hit
node alerts/telegram.cjs sl '{"loss":"675","reason":"..."}'

# Trade exit
node alerts/telegram.cjs exit '{"pnl":2250,"pnlPct":"+1.87%",...}'

# 12hr watchlist update
node alerts/telegram.cjs update '{"assets":[...]}'

# Chart screenshot
node alerts/telegram.cjs photo '/path/to/screenshot.png'
```

## MT5 Trade Commands

```bash
# Market sell with price-based SL/TP
node alerts/mt5.cjs sell '{"symbol":"XAUUSD","lot":0.01,"sl_price":4835,"tp_price":4741}'

# Market buy
node alerts/mt5.cjs buy '{"symbol":"XAUUSD","lot":0.01,"sl_price":4695,"tp_price":4735}'

# Close all positions
node alerts/mt5.cjs close '{"symbol":"XAUUSD","reason":"TP hit"}'

# Check bridge status
node alerts/mt5.cjs check
```

## Safety Limits

| Guard | Default |
|-------|---------|
| Max open positions | 1 |
| Max trades per day | 3 |
| Max daily loss | $50 |
| Stop loss | Required on every trade |
| Minimum R:R | 2:1 |
| Weekend trading | Disabled |

## Voice Commands (in Claude Code)

| You say | What happens |
|---------|-------------|
| "Short GOLD 0.05 lots, SL 4835, TP 4741" | Executes on MT5 + Telegram alert |
| "TP1 hit, close 40%" | Partial close + moves SL to BE |
| "Close GOLD" | Closes all + exit alert |
| "Move SL to breakeven" | Modifies SL on open position |
| "12hr update" | Scans watchlist + sends to Telegram |
| "Draw S/R levels" | Calculates and draws on chart |
| "Read my LuxAlgo indicators" | Full indicator report |
| "Pause auto-trader" | Disables in config |
| "Update zones" | Refreshes entry/SL/TP from chart |

## License

MIT

## Disclaimer

This is a personal trading tool for educational and demo purposes. Automated trading carries significant risk. Never trade with money you cannot afford to lose. The authors are not responsible for any financial losses.
