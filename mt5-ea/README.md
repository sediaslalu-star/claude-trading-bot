# TV.mq5 — MetaTrader 5 Expert Advisor

Signal bridge between Claude Code and MetaTrader 5. Reads trade commands from `signal.json` and executes them on the chart.

## Features

- **ENTRY** — Market buy/sell with price-based SL/TP or point-based SL/TP
- **CLOSE** — Close all positions on a symbol
- **PARTIAL_CLOSE** — Close X% of an open position (for scaling out at TP1/TP2)
- **MODIFY** — Change SL/TP on an open position (trailing stop, move to breakeven)
- Polls `signal.json` every 100ms
- Writes execution results to `ack.json`
- Symbol normalization (GOLD → XAUUSD, strips broker suffixes like .o, .a)
- Duplicate signal protection (skips already-processed signal IDs)

## Installation

### macOS (Wine/CrossOver MT5)

```bash
# Find your MT5 Experts folder
find ~/Library -path "*/MetaTrader 5/MQL5/Experts" -type d 2>/dev/null

# Copy the EA
cp mt5-ea/TV.mq5 "/Users/YOUR_USERNAME/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Experts/"
```

### Windows

```batch
copy TV.mq5 "C:\Program Files\MetaTrader 5\MQL5\Experts\"
```

### After copying

1. Open **MetaEditor** (F4 in MT5)
2. Open `TV.mq5` from the Experts folder
3. Click **Compile** (F7)
4. Go back to MT5
5. In **Navigator** panel → **Expert Advisors** → drag **TV** onto your chart
6. Enable **AutoTrading** (green play button in toolbar)
7. In EA properties, verify:
   - `InpSecret`: `test123` (must match your alerts/config.json)
   - `InpDefaultLot`: `0.01` (adjust to your preference)
   - `InpPollMs`: `100`
   - `InpSlippagePts`: `30`
   - `InpMagicNumber`: `123456`

## How It Works

```
Claude Code writes signal.json
         ↓
TV.mq5 EA reads it (every 100ms)
         ↓
Validates secret, symbol, event type
         ↓
Executes on MT5 (market order, close, modify)
         ↓
Writes result to ack.json
         ↓
Claude Code reads ack.json (confirmation)
```

### File Locations

| Platform | signal.json / ack.json path |
|----------|-----------------------------|
| macOS Wine | `~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files/` |
| macOS CrossOver | `~/Library/Application Support/CrossOver/Bottles/<bottle>/drive_c/Program Files/MetaTrader 5/MQL5/Files/` |
| Windows | `C:\Program Files\MetaTrader 5\MQL5\Files\` |

## Signal Protocol

### ENTRY (open a position)

```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "ENTRY",
  "direction": "SELL",
  "lot": 0.01,
  "sl_price": 4835,
  "tp_price": 4741,
  "id": "unique-signal-id"
}
```

Alternative with point-based SL/TP:
```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "ENTRY",
  "direction": "BUY",
  "lot": 0.01,
  "sl_points": 5000,
  "tp_points": 10000,
  "id": "unique-signal-id"
}
```

### CLOSE (close all positions on symbol)

```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "CLOSE",
  "id": "unique-signal-id"
}
```

### PARTIAL_CLOSE (close percentage of position)

```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "PARTIAL_CLOSE",
  "percent": 40,
  "id": "unique-signal-id"
}
```

### MODIFY (change SL/TP on open position)

```json
{
  "secret": "test123",
  "symbol": "XAUUSD",
  "event": "MODIFY",
  "sl_price": 4808,
  "tp_price": 4611,
  "id": "unique-signal-id"
}
```

## Acknowledgment (ack.json)

After processing a signal, the EA writes:

```json
{
  "id": "unique-signal-id",
  "status": "EXECUTED",
  "symbol": "XAUUSD.o",
  "direction": "SELL",
  "lot": 0.01,
  "price": 4788.70000,
  "ticket": 12323703,
  "time": "2026-04-08 11:37:29"
}
```

Possible status values:
- `EXECUTED` — trade placed successfully
- `CLOSED` — position closed
- `PARTIAL_CLOSED` — partial close executed
- `MODIFIED` — SL/TP changed
- `SKIPPED` — position already open (duplicate prevention)
- `FAILED` — order rejected (check `error` field)
- `NO_POSITION` — tried to close/modify but no position exists

## Troubleshooting

| Issue | Fix |
|-------|-----|
| EA not responding | Check AutoTrading is enabled (green button) |
| "Position already open" | EA prevents duplicate entries — close first or use MODIFY |
| SL/TP not set | Some brokers reject SL/TP on market order — EA sends MODIFY after as backup |
| Wrong symbol | EA normalizes symbols — GOLD becomes XAUUSD, strips .o/.a suffixes |
| signal.json not found | Check MQL5/Files/ folder permissions |
