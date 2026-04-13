// ═══════════════════════════════════════════════════════════════
//  GOLD AUTO-TRADER — Scans chart every 15min, executes if conditions match
//  Claude Code ↔ TradingView MCP ↔ MT5 EA ↔ Telegram
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');
const LOG_PATH = path.join(__dirname, 'trades.log');
const RUN_TOOL = '/opt/homebrew/bin/node /Users/saieswarboda/tradingview-mcp/run_tool.cjs';
const MT5_TOOL = '/opt/homebrew/bin/node /Users/saieswarboda/tradingview-mcp/alerts/mt5.cjs';
const TG_TOOL = '/opt/homebrew/bin/node /Users/saieswarboda/tradingview-mcp/alerts/telegram.cjs';

// ─── HELPERS ───
function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { trades_today: 0, last_trade_date: '', open_position: false, entry_price: 0, direction: '', daily_pnl: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

function runTool(name, args = {}) {
  try {
    const result = execSync(`${RUN_TOOL} ${name} '${JSON.stringify(args)}'`, {
      encoding: 'utf8', timeout: 15000
    }).trim();
    return JSON.parse(result);
  } catch (e) {
    log(`ERROR running ${name}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

function sendTelegram(action, data) {
  try {
    execSync(`${TG_TOOL} ${action} '${JSON.stringify(data).replace(/'/g, "'\\''")}'`, {
      encoding: 'utf8', timeout: 10000
    });
  } catch (e) {
    log(`Telegram ${action} failed: ${e.message}`);
  }
}

function executeMT5(action, params) {
  try {
    const result = execSync(`${MT5_TOOL} ${action} '${JSON.stringify(params).replace(/'/g, "'\\''")}'`, {
      encoding: 'utf8', timeout: 15000
    });
    return result;
  } catch (e) {
    log(`MT5 ${action} failed: ${e.message}`);
    return null;
  }
}

// ─── PRE-FLIGHT CHECKS ───
function preFlightChecks(config, state) {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  // Weekend check
  if (config.schedule.skip_weekends && (day === 0 || day === 6)) {
    log('SKIP: Weekend — market closed');
    return false;
  }

  // Active hours check
  if (!config.schedule.active_hours_utc.includes(hour)) {
    log(`SKIP: Outside active hours (UTC ${hour})`);
    return false;
  }

  // Reset daily counter if new day
  const today = now.toISOString().slice(0, 10);
  if (state.last_trade_date !== today) {
    state.trades_today = 0;
    state.daily_pnl = 0;
    state.last_trade_date = today;
    saveState(state);
  }

  // Max trades per day
  if (state.trades_today >= config.risk.max_trades_per_day) {
    log(`SKIP: Max trades per day reached (${state.trades_today}/${config.risk.max_trades_per_day})`);
    return false;
  }

  // Max daily loss
  if (state.daily_pnl <= -config.risk.max_daily_loss_usd) {
    log(`SKIP: Max daily loss reached ($${state.daily_pnl})`);
    sendTelegram('custom', `⛔ Auto-trader stopped — max daily loss reached ($${state.daily_pnl}). @saieswarboda`);
    return false;
  }

  // Enabled check
  if (!config.enabled) {
    log('SKIP: Auto-trader disabled in config');
    return false;
  }

  return true;
}

// ─── READ CHART DATA ───
function readChart(config) {
  log('Reading chart data...');

  // Switch to 15min for bias
  runTool('chart_set_timeframe', { timeframe: config.timeframe_bias });

  // Small delay for chart to load — we'll just proceed, EA is fast
  const quote = runTool('quote_get');
  if (!quote.success) {
    log('ERROR: Could not get quote');
    return null;
  }

  const studies = runTool('data_get_study_values');
  if (!studies.success) {
    log('ERROR: Could not get study values');
    return null;
  }

  const labels = runTool('data_get_pine_labels', { study_filter: 'Price Action', max_labels: 10 });
  const ohlcv = runTool('data_get_ohlcv', { summary: true });

  // Parse indicator values
  let smartTrail = 0, smartTrailExt = 0, trendStrength = 0;
  let bullishSignal = 0, bearishSignal = 0;
  let eqTop = 0, eqBottom = 0, discountTop = 0, premiumBottom = 0;

  for (const study of (studies.studies || [])) {
    if (study.name.includes('Signals & Overlays')) {
      smartTrail = parseFloat((study.values['Smart Trail'] || '0').replace(/,/g, ''));
      smartTrailExt = parseFloat((study.values['Smart Trail Extremity'] || '0').replace(/,/g, ''));
      trendStrength = parseFloat((study.values['Trend Strength'] || '0').replace(/,/g, ''));
      bullishSignal = parseFloat((study.values['Bullish'] || '0').replace(/,/g, ''));
      bearishSignal = parseFloat((study.values['Bearish'] || '0').replace(/,/g, ''));
    }
    if (study.name.includes('Price Action Concepts')) {
      eqTop = parseFloat((study.values['Equilibrium Top'] || '0').replace(/,/g, ''));
      eqBottom = parseFloat((study.values['Equilibrium Bottom'] || '0').replace(/,/g, ''));
      discountTop = parseFloat((study.values['Discount Top'] || '0').replace(/,/g, ''));
      premiumBottom = parseFloat((study.values['Premium Bottom'] || '0').replace(/,/g, ''));
    }
  }

  // Recent structure from labels
  const recentLabels = (labels.studies?.[0]?.labels || []).slice(-5);
  const lastBOS = recentLabels.filter(l => l.text === 'BOS');
  const lastCHoCH = recentLabels.filter(l => l.text.includes('CHoCH'));

  const price = quote.close || quote.last;

  return {
    price,
    symbol: quote.symbol,
    smartTrail,
    smartTrailExt,
    trendStrength,
    bullishSignal,
    bearishSignal,
    bullishPlus: parseFloat(((studies.studies || []).find(s => s.name.includes('Signals'))?.values['Bullish+'] || '0').replace(/,/g, '')),
    bearishPlus: parseFloat(((studies.studies || []).find(s => s.name.includes('Signals'))?.values['Bearish+'] || '0').replace(/,/g, '')),
    eqTop,
    eqBottom,
    discountTop,
    premiumBottom,
    recentLabels,
    lastBOS,
    lastCHoCH,
    ohlcv: ohlcv.success ? ohlcv : null
  };
}

// ─── EVALUATE CONDITIONS ───
function evaluateConditions(data, config) {
  const { price, smartTrail, trendStrength, bullishSignal, bearishSignal,
          bullishPlus, bearishPlus, eqTop, eqBottom, discountTop, premiumBottom,
          lastCHoCH } = data;
  const z = config.zones;

  const conditions = {
    // Price position
    price_below_smart_trail: price < smartTrail,
    price_above_smart_trail: price > smartTrail,
    price_above_discount_top: price > discountTop,

    // Trend
    trend_strength_above_5: trendStrength > 5,

    // Signals
    bullish_signal_fired: bullishSignal > 0 || bullishPlus > 0,
    bearish_signal_fired: bearishSignal > 0 || bearishPlus > 0,

    // Structure
    bearish_structure: lastCHoCH.some(l => l.text.includes('CHoCH') && l.price > price),
    bullish_structure_or_choch: lastCHoCH.some(l => l.text.includes('CHoCH') && l.price < price),

    // Zones
    price_in_eq_zone: price >= eqBottom && price <= eqTop,
    price_in_short_zone: price >= z.short_entry_bottom && price <= z.short_entry_top,
    price_in_long_zone: price >= z.long_entry_bottom && price <= z.long_entry_top,
    price_in_fvg_zone: price >= z.long_entry_bottom && price <= z.long_entry_top,

    // S/R proximity (within $15)
    price_at_resistance: price >= z.short_entry_bottom - 15 && price <= z.short_entry_top + 5,
    price_at_support: price >= z.long_entry_bottom - 5 && price <= z.long_entry_top + 15
  };

  return conditions;
}

function checkShortEntry(conditions, config) {
  const rules = config.entry_conditions.short;
  const allMet = rules.all_required.every(c => conditions[c] === true);
  const anyMet = rules.any_required.some(c => conditions[c] === true);

  const metAll = rules.all_required.filter(c => conditions[c]);
  const metAny = rules.any_required.filter(c => conditions[c]);
  const failedAll = rules.all_required.filter(c => !conditions[c]);

  return {
    triggered: allMet && anyMet,
    met_all: metAll,
    met_any: metAny,
    failed: failedAll,
    direction: 'SHORT'
  };
}

function checkLongEntry(conditions, config) {
  const rules = config.entry_conditions.long;
  const allMet = rules.all_required.every(c => conditions[c] === true);
  const anyMet = rules.any_required.some(c => conditions[c] === true);

  const metAll = rules.all_required.filter(c => conditions[c]);
  const metAny = rules.any_required.filter(c => conditions[c]);
  const failedAll = rules.all_required.filter(c => !conditions[c]);

  return {
    triggered: allMet && anyMet,
    met_all: metAll,
    met_any: metAny,
    failed: failedAll,
    direction: 'LONG'
  };
}

// ─── MANAGE OPEN POSITION ───
function managePosition(data, config, state) {
  if (!state.open_position) return;

  const { price } = data;
  const z = config.zones;
  const mgmt = config.management;

  if (state.direction === 'SHORT') {
    // Check TP1
    if (!state.tp1_hit && price <= z.short_tp1) {
      log(`🎯 TP1 HIT — price ${price} <= ${z.short_tp1}`);
      state.tp1_hit = true;

      // Partial close
      const partialSignal = {
        secret: 'test123', symbol: 'XAUUSD', event: 'PARTIAL_CLOSE',
        percent: mgmt.tp1_close_percent,
        id: `claude-tp1-${Date.now()}`
      };
      const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
      fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify(partialSignal, null, 2));

      // Move SL to BE
      if (mgmt.move_sl_to_be_at_tp1) {
        setTimeout(() => {
          const modifySignal = {
            secret: 'test123', symbol: 'XAUUSD', event: 'MODIFY',
            sl_price: state.entry_price, tp_price: z.short_tp2,
            id: `claude-slbe-${Date.now()}`
          };
          fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify(modifySignal, null, 2));
        }, 2000);
      }

      sendTelegram('tp', {
        symbol: 'GOLD', direction: 'SHORT', tpLevel: 'TP1', tpPrice: String(z.short_tp1),
        partialClose: `${mgmt.tp1_close_percent}% closed`, remaining: `${100 - mgmt.tp1_close_percent}% running to TP2`
      });
      saveState(state);
    }

    // Check TP2
    if (state.tp1_hit && !state.tp2_hit && price <= z.short_tp2) {
      log(`🎯 TP2 HIT — price ${price} <= ${z.short_tp2}`);
      state.tp2_hit = true;

      const partialSignal = {
        secret: 'test123', symbol: 'XAUUSD', event: 'PARTIAL_CLOSE',
        percent: 50, // 50% of remaining
        id: `claude-tp2-${Date.now()}`
      };
      const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
      fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify(partialSignal, null, 2));

      sendTelegram('tp', {
        symbol: 'GOLD', direction: 'SHORT', tpLevel: 'TP2', tpPrice: String(z.short_tp2),
        partialClose: '50% of remaining closed', remaining: 'Runner to TP3'
      });
      saveState(state);
    }
  }

  // Mirror logic for LONG (same structure, inverted direction)
  if (state.direction === 'LONG') {
    if (!state.tp1_hit && price >= z.long_tp1) {
      log(`🎯 TP1 HIT — price ${price} >= ${z.long_tp1}`);
      state.tp1_hit = true;

      const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
      fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify({
        secret: 'test123', symbol: 'XAUUSD', event: 'PARTIAL_CLOSE',
        percent: mgmt.tp1_close_percent, id: `claude-tp1-${Date.now()}`
      }, null, 2));

      if (mgmt.move_sl_to_be_at_tp1) {
        setTimeout(() => {
          fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify({
            secret: 'test123', symbol: 'XAUUSD', event: 'MODIFY',
            sl_price: state.entry_price, tp_price: z.long_tp2, id: `claude-slbe-${Date.now()}`
          }, null, 2));
        }, 2000);
      }

      sendTelegram('tp', {
        symbol: 'GOLD', direction: 'LONG', tpLevel: 'TP1', tpPrice: String(z.long_tp1),
        partialClose: `${mgmt.tp1_close_percent}% closed`, remaining: `${100 - mgmt.tp1_close_percent}% running to TP2`
      });
      saveState(state);
    }

    if (state.tp1_hit && !state.tp2_hit && price >= z.long_tp2) {
      log(`🎯 TP2 HIT — price ${price} >= ${z.long_tp2}`);
      state.tp2_hit = true;

      const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
      fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify({
        secret: 'test123', symbol: 'XAUUSD', event: 'PARTIAL_CLOSE',
        percent: 50, id: `claude-tp2-${Date.now()}`
      }, null, 2));

      sendTelegram('tp', {
        symbol: 'GOLD', direction: 'LONG', tpLevel: 'TP2', tpPrice: String(z.long_tp2),
        partialClose: '50% of remaining closed', remaining: 'Runner to TP3'
      });
      saveState(state);
    }
  }
}

// ─── EXECUTE TRADE ───
function executeTrade(direction, data, config, state) {
  const z = config.zones;
  const lot = config.risk.lot_size;

  let sl, tp1, tp2, tp3;
  if (direction === 'SHORT') {
    sl = z.short_sl; tp1 = z.short_tp1; tp2 = z.short_tp2; tp3 = z.short_tp3;
  } else {
    sl = z.long_sl; tp1 = z.long_tp1; tp2 = z.long_tp2; tp3 = z.long_tp3;
  }

  log(`🚀 EXECUTING ${direction} ${lot} XAUUSD — SL: ${sl}, TP1: ${tp1}`);

  const action = direction === 'SHORT' ? 'sell' : 'buy';
  const result = executeMT5(action, {
    symbol: 'XAUUSD',
    lot,
    sl_price: sl,
    tp_price: tp1,
    sl: String(sl),
    tp1: String(tp1),
    tp2: String(tp2),
    tp3: String(tp3),
    timeframe: '5min/15min',
    riskReward: `${((Math.abs(data.price - tp1) / Math.abs(data.price - sl))).toFixed(1)}:1`,
    reason: `Auto-trader: ${direction} triggered. Price ${data.price}, Smart Trail ${data.smartTrail}, Trend Strength ${data.trendStrength}`,
    confluence: [
      `Price ${data.price < data.smartTrail ? 'below' : 'above'} Smart Trail (${data.smartTrail})`,
      `Trend Strength: ${data.trendStrength}/10`,
      data.bearishSignal > 0 ? 'LuxAlgo Bearish signal active' : data.bullishSignal > 0 ? 'LuxAlgo Bullish signal active' : 'No active LuxAlgo signal',
      `Price in ${direction === 'SHORT' ? 'short' : 'long'} entry zone`,
      `Structure: ${data.lastCHoCH.map(l => `${l.text} @ ${l.price}`).join(', ') || 'N/A'}`
    ]
  });

  if (result && result.includes('EXECUTED')) {
    state.open_position = true;
    state.direction = direction;
    state.entry_price = data.price;
    state.trades_today++;
    state.tp1_hit = false;
    state.tp2_hit = false;
    saveState(state);
    log(`✅ Trade executed — ${direction} @ ${data.price}`);

    // Safety net: some brokers reject SL/TP on market order — send MODIFY to guarantee SL/TP
    setTimeout(() => {
      const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
      const modifySignal = {
        secret: 'test123', symbol: 'XAUUSD', event: 'MODIFY',
        sl_price: sl, tp_price: tp1,
        id: `claude-ensure-sltp-${Date.now()}`
      };
      fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify(modifySignal, null, 2));
      log(`🔒 MODIFY sent to guarantee SL: ${sl}, TP: ${tp1}`);
    }, 2000);
  } else {
    log(`❌ Trade execution failed`);
    if (config.notifications.telegram_on_error) {
      sendTelegram('custom', `❌ Auto-trader failed to execute ${direction} GOLD @ ${data.price}. Check MT5. @saieswarboda`);
    }
  }
}

// ─── MAIN SCAN ───
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const verbose = process.argv.includes('--verbose');

  log('═══════════════════════════════════════');
  log(`AUTO-TRADER SCAN ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  log('═══════════════════════════════════════');

  const config = loadConfig();
  const state = loadState();

  // Pre-flight
  if (!preFlightChecks(config, state)) return;

  // Read chart
  const data = readChart(config);
  if (!data) {
    log('ERROR: Could not read chart data. Is TradingView running?');
    if (config.notifications.telegram_on_error) {
      sendTelegram('custom', '⚠️ Auto-trader: Cannot read TradingView chart. Is CDP running? @saieswarboda');
    }
    return;
  }

  log(`Price: ${data.price} | Smart Trail: ${data.smartTrail} | Trend: ${data.trendStrength}`);
  log(`Signals — Bull: ${data.bullishSignal} | Bear: ${data.bearishSignal}`);
  log(`Structure — EQ: ${data.eqBottom}-${data.eqTop} | Discount: ${data.discountTop}`);

  // If position is open — manage it (TP/SL tracking)
  if (state.open_position) {
    log(`Managing open ${state.direction} position (entry: ${state.entry_price})`);
    managePosition(data, config, state);
    return;
  }

  // Evaluate entry conditions
  const conditions = evaluateConditions(data, config);

  if (verbose) {
    log('Conditions:');
    for (const [k, v] of Object.entries(conditions)) {
      log(`  ${v ? '✅' : '❌'} ${k}`);
    }
  }

  const shortCheck = checkShortEntry(conditions, config);
  const longCheck = checkLongEntry(conditions, config);

  log(`SHORT: ${shortCheck.triggered ? '🟢 TRIGGERED' : '🔴 No'} | Met: ${shortCheck.met_all.join(', ')} + ${shortCheck.met_any.join(', ')} | Failed: ${shortCheck.failed.join(', ')}`);
  log(`LONG:  ${longCheck.triggered ? '🟢 TRIGGERED' : '🔴 No'} | Met: ${longCheck.met_all.join(', ')} + ${longCheck.met_any.join(', ')} | Failed: ${longCheck.failed.join(', ')}`);

  // Execute if triggered
  if (shortCheck.triggered) {
    if (dryRun) {
      log('DRY RUN — would execute SHORT');
      sendTelegram('custom', `🔍 Auto-trader DRY RUN: SHORT signal detected @ ${data.price}. Not executing (dry-run mode). @saieswarboda`);
    } else {
      executeTrade('SHORT', data, config, state);
    }
  } else if (longCheck.triggered) {
    if (dryRun) {
      log('DRY RUN — would execute LONG');
      sendTelegram('custom', `🔍 Auto-trader DRY RUN: LONG signal detected @ ${data.price}. Not executing (dry-run mode). @saieswarboda`);
    } else {
      executeTrade('LONG', data, config, state);
    }
  } else {
    log('No entry conditions met — standing aside');
    if (config.notifications.telegram_on_skip && verbose) {
      sendTelegram('custom', `⏳ Auto-scan: No setup @ ${data.price}. Short needs: ${shortCheck.failed.join(', ')}. @saieswarboda`);
    }
  }

  log('Scan complete');
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
});
