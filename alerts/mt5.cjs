// MT5 Trade Executor — writes signals to MT5 via TV.mq5 EA bridge
// Protocol: write signal.json → EA reads & executes → writes ack.json
const fs = require('fs');
const path = require('path');

const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
const SIGNAL_FILE = path.join(MT5_FILES, 'signal.json');
const ACK_FILE = path.join(MT5_FILES, 'ack.json');
const SECRET = 'test123'; // Must match EA input InpSecret

// Load telegram config for notifications
const telegramPath = path.join(__dirname, 'telegram.cjs');

function generateId() {
  return `claude-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeSignal(signal) {
  const json = JSON.stringify(signal, null, 2);
  fs.writeFileSync(SIGNAL_FILE, json, 'utf8');
  console.log(`Signal written: ${signal.event} ${signal.direction || ''} ${signal.symbol} ${signal.lot || ''}`);
}

function waitForAck(signalId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      try {
        if (fs.existsSync(ACK_FILE)) {
          const ack = JSON.parse(fs.readFileSync(ACK_FILE, 'utf8'));
          if (ack.id === signalId) {
            clearInterval(interval);
            resolve(ack);
            return;
          }
        }
      } catch (e) {}

      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for MT5 acknowledgment. Is the EA running on the chart?'));
      }
    }, 200);
  });
}

// ─── ENTRY ORDER ───
async function entry({ symbol, direction, lot, sl_points, tp_points }) {
  const id = generateId();
  const signal = {
    secret: SECRET,
    symbol: symbol.toUpperCase(),
    event: 'ENTRY',
    direction: direction.toUpperCase(),
    lot: lot || 0.01,
    id
  };
  if (sl_points) signal.sl_points = sl_points;
  if (tp_points) signal.tp_points = tp_points;

  writeSignal(signal);

  try {
    const ack = await waitForAck(id);
    console.log('\n' + JSON.stringify(ack, null, 2));

    if (ack.status === 'EXECUTED') {
      console.log(`\n✅ ${direction} ${lot} ${symbol} @ ${ack.price} | Ticket: ${ack.ticket}`);
    } else {
      console.log(`\n❌ ${ack.status}: ${ack.error || 'Unknown error'}`);
    }
    return ack;
  } catch (e) {
    console.error('\n❌', e.message);
    return { status: 'TIMEOUT', error: e.message };
  }
}

// ─── CLOSE POSITION ───
async function close({ symbol }) {
  const id = generateId();
  const signal = {
    secret: SECRET,
    symbol: symbol.toUpperCase(),
    event: 'CLOSE',
    direction: '-',
    lot: 0,
    id
  };

  writeSignal(signal);

  try {
    const ack = await waitForAck(id);
    console.log('\n' + JSON.stringify(ack, null, 2));

    if (ack.status === 'CLOSED') {
      console.log(`\n✅ Closed ${symbol} @ ${ack.price} | Ticket: ${ack.ticket}`);
    } else {
      console.log(`\n⚠️  ${ack.status}: ${ack.error || ''}`);
    }
    return ack;
  } catch (e) {
    console.error('\n❌', e.message);
    return { status: 'TIMEOUT', error: e.message };
  }
}

// ─── READ LAST ACK ───
function lastAck() {
  try {
    const ack = JSON.parse(fs.readFileSync(ACK_FILE, 'utf8'));
    console.log(JSON.stringify(ack, null, 2));
    return ack;
  } catch (e) {
    console.log('No ack.json found or invalid');
    return null;
  }
}

// ─── ENTRY + TELEGRAM ALERT ───
async function entryWithAlert(params) {
  const ack = await entry(params);

  if (ack.status === 'EXECUTED') {
    // Send Telegram alert
    const { execSync } = require('child_process');
    const alertData = {
      direction: params.direction.toUpperCase(),
      symbol: params.symbol.toUpperCase(),
      entry: String(ack.price),
      sl: params.sl_price || (params.sl_points ? `${params.sl_points} pts` : 'None'),
      tp1: params.tp1 || (params.tp_points ? `${params.tp_points} pts` : 'None'),
      tp2: params.tp2 || '',
      tp3: params.tp3 || '',
      timeframe: params.timeframe || '5min/15min',
      riskReward: params.riskReward || '-',
      reason: params.reason || 'Trade executed via MT5 bridge',
      confluence: params.confluence || ['Signal from Claude strategy']
    };

    try {
      // Take screenshot if TradingView is running
      const { spawn } = require('child_process');
      const screenshotResult = execSync(
        `/opt/homebrew/bin/node /Users/saieswarboda/tradingview-mcp/run_tool.cjs capture_screenshot '{"region":"chart"}'`,
        { encoding: 'utf8', timeout: 10000 }
      ).trim();
      const ssData = JSON.parse(screenshotResult);
      if (ssData.success) alertData.screenshot = ssData.file_path;
    } catch (e) {}

    try {
      execSync(
        `/opt/homebrew/bin/node ${telegramPath} entry '${JSON.stringify(alertData).replace(/'/g, "'\\''")}'`,
        { encoding: 'utf8', timeout: 10000 }
      );
      console.log('📱 Telegram alert sent');
    } catch (e) {
      console.log('⚠️  Telegram alert failed:', e.message);
    }
  }

  return ack;
}

// ─── CLOSE + TELEGRAM ALERT ───
async function closeWithAlert(params) {
  // Read current ack to get entry price
  let entryPrice = '-';
  try {
    const prevAck = JSON.parse(fs.readFileSync(ACK_FILE, 'utf8'));
    if (prevAck.status === 'EXECUTED') entryPrice = String(prevAck.price);
  } catch (e) {}

  const ack = await close(params);

  if (ack.status === 'CLOSED') {
    const { execSync } = require('child_process');
    const exitData = {
      symbol: params.symbol.toUpperCase(),
      direction: ack.direction || '-',
      entryPrice: entryPrice,
      exitPrice: String(ack.price),
      pnl: params.pnl || 0,
      pnlPct: params.pnlPct || '-',
      reason: params.reason || 'Position closed via MT5 bridge'
    };

    try {
      execSync(
        `/opt/homebrew/bin/node ${telegramPath} exit '${JSON.stringify(exitData).replace(/'/g, "'\\''")}'`,
        { encoding: 'utf8', timeout: 10000 }
      );
      console.log('📱 Telegram exit alert sent');
    } catch (e) {
      console.log('⚠️  Telegram alert failed:', e.message);
    }
  }

  return ack;
}

// ─── CLI ───
async function main() {
  const action = process.argv[2];

  if (action === 'buy' || action === 'sell') {
    const params = process.argv[3] ? JSON.parse(process.argv[3]) : {};
    params.direction = action.toUpperCase();
    params.symbol = params.symbol || 'XAUUSD';
    await entryWithAlert(params);
  }

  else if (action === 'close') {
    const params = process.argv[3] ? JSON.parse(process.argv[3]) : {};
    params.symbol = params.symbol || 'XAUUSD';
    await closeWithAlert(params);
  }

  else if (action === 'raw') {
    // Raw signal — full control
    const signal = JSON.parse(process.argv[3]);
    signal.secret = signal.secret || SECRET;
    signal.id = signal.id || generateId();
    writeSignal(signal);
    const ack = await waitForAck(signal.id);
    console.log(JSON.stringify(ack, null, 2));
  }

  else if (action === 'status') {
    lastAck();
  }

  else if (action === 'check') {
    // Check if signal.json and ack.json are accessible
    console.log('MT5 Files path:', MT5_FILES);
    console.log('signal.json exists:', fs.existsSync(SIGNAL_FILE));
    console.log('ack.json exists:', fs.existsSync(ACK_FILE));
    if (fs.existsSync(ACK_FILE)) {
      console.log('\nLast ACK:');
      lastAck();
    }
  }

  else {
    console.log(`
MT5 Trade Executor — Claude ↔ MT5 Bridge
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage:
  node mt5.cjs buy  '{"symbol":"XAUUSD","lot":0.01,"sl_points":350,"tp_points":670}'
  node mt5.cjs sell '{"symbol":"XAUUSD","lot":0.01,"sl_points":350,"tp_points":670}'
  node mt5.cjs close '{"symbol":"XAUUSD","reason":"TP hit"}'
  node mt5.cjs status                    Show last trade acknowledgment
  node mt5.cjs check                     Verify MT5 file bridge is working

Extended (with Telegram alert + screenshot):
  node mt5.cjs buy '${JSON.stringify({
    symbol: "XAUUSD", lot: 0.01, sl_points: 350, tp_points: 670,
    sl_price: "4,773", tp1: "4,741", tp2: "4,718", tp3: "4,611",
    timeframe: "5min/15min", riskReward: "4.8:1",
    reason: "Bearish CHoCH+ on 4H, rejection at Smart Trail",
    confluence: ["Below Smart Trail", "CHoCH+ bearish", "EQ zone rejection"]
  })}'

Notes:
  - EA (TV.mq5) must be running on XAUUSD chart in MT5
  - EA polls signal.json every 100ms
  - sl_points and tp_points are in broker points (1 point = 0.001 for gold)
  - For GOLD: $1 move = 1000 points (e.g., SL $35 = 35000 points? Check your broker)

Point Conversion (MaziMatic — check your contract specs):
  XAUUSD: 1 pip = 0.01, 1 point = 0.001 typically
  To set SL at $4,773 from entry $4,808: difference = $35 = 35000 points (if point=0.001)
  ⚠️  VERIFY with your broker's contract specification first!
`);
  }
}

main().catch(console.error);
