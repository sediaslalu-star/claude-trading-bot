// ═══════════════════════════════════════════════════════════════
//  GOLD AUTO-TRADER LITE — Direct CDP, no MCP server spawning
//  Reads TradingView chart directly via WebSocket → CDP
//  Zero zombie processes, ~5MB memory footprint
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const STATE_PATH = path.join(__dirname, 'state.json');
const LOG_PATH = path.join(__dirname, 'trades.log');
const MT5_FILES = '/Users/saieswarboda/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Files';
const TG_TOOL = '/opt/homebrew/bin/node /Users/saieswarboda/tradingview-mcp/alerts/telegram.cjs';

// ─── HELPERS ───
function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { trades_today: 0, last_trade_date: '', open_position: false, entry_price: 0, direction: '', daily_pnl: 0, tp1_hit: false, tp2_hit: false }; }
}
function saveState(s) { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

function sendTelegram(action, data) {
  try {
    execSync(`${TG_TOOL} ${action} '${JSON.stringify(data).replace(/'/g, "'\\''")}'`, { encoding: 'utf8', timeout: 10000 });
  } catch {}
}

function writeMT5Signal(signal) {
  signal.secret = signal.secret || 'test123';
  signal.id = signal.id || `claude-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(path.join(MT5_FILES, 'signal.json'), JSON.stringify(signal, null, 2));
  log(`MT5 signal: ${signal.event} ${signal.direction || ''}`);
}

function readMT5Ack(expectedId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ack = JSON.parse(fs.readFileSync(path.join(MT5_FILES, 'ack.json'), 'utf8'));
      if (ack.id === expectedId) return ack;
    } catch {}
    // Busy wait in small increments
    const waitUntil = Date.now() + 200;
    while (Date.now() < waitUntil) {}
  }
  return null;
}

// ─── CDP DIRECT CONNECTION ───
function getChartPageWs() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const pages = JSON.parse(data);
          const chart = pages.find(p => p.url?.includes('tradingview.com/chart'));
          resolve(chart?.webSocketDebuggerUrl || null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function cdpEval(wsUrl, expression) {
  // Dynamic import WebSocket
  let WebSocket;
  try { WebSocket = require('ws'); } catch {
    log('ERROR: ws module not found');
    return null;
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); resolve(null); }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    });
    ws.on('message', (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.id === 1) {
          clearTimeout(timeout);
          ws.close();
          resolve(data.result?.result?.value ?? null);
        }
      } catch {}
    });
    ws.on('error', () => { clearTimeout(timeout); resolve(null); });
  });
}

// ─── READ ALL CHART DATA IN ONE CDP CALL ───
async function readChartData(wsUrl) {
  const script = `
    (function() {
      try {
        const cc = window.TradingViewApi || window._exposed_chartWidgetCollection?.getAll?.()[0];
        if (!cc) return JSON.stringify({ error: 'no chart API' });

        const chart = cc.activeChart ? cc.activeChart() : cc;
        const series = chart.getSeries ? chart.getSeries() : null;

        // Price
        const ask = series?.quotes?.()?.ask || 0;
        const bid = series?.quotes?.()?.bid || 0;
        const last = series?.quotes?.()?.last_price || (ask + bid) / 2;

        // Studies
        const studies = chart.getAllStudies ? chart.getAllStudies() : [];
        const studyValues = {};

        for (const s of studies) {
          try {
            const src = chart.getStudyById(s.id);
            if (!src) continue;
            const info = src.getSourceInfo ? src.getSourceInfo() : {};
            const dw = src.dataAndViewsReady?.() ? src._study?._metaInfo : null;
            studyValues[info.description || s.id] = {};

            // Get plot values from the data window
            const plots = src._study?._model?.m_plotValues?.();
            if (plots) {
              const names = src._study?._metaInfo?.plots || [];
              for (let i = 0; i < names.length && i < plots.length; i++) {
                const name = names[i]?.id || 'plot_' + i;
                const val = plots[i];
                if (val !== undefined && val !== null && !isNaN(val))
                  studyValues[info.description || s.id][name] = val;
              }
            }
          } catch {}
        }

        // Get visible indicator values from data window more reliably
        const dw = document.querySelector('.chart-data-window');
        let dataWindowText = '';
        if (dw) dataWindowText = dw.innerText;

        return JSON.stringify({ last, ask, bid, studyValues, dataWindowText: dataWindowText.slice(0, 2000) });
      } catch (e) {
        return JSON.stringify({ error: e.message });
      }
    })()
  `;

  const result = await cdpEval(wsUrl, script);
  if (!result) return null;
  try { return JSON.parse(result); } catch { return null; }
}

// Run a single MCP tool call with cleanup
function runMCPTool(name, args = '{}') {
  try {
    const output = execSync(
      `/opt/homebrew/bin/node /Users/saieswarboda/tradingview-mcp/run_tool.cjs ${name} '${args}'`,
      { encoding: 'utf8', timeout: 12000, killSignal: 'SIGKILL' }
    ).trim();
    return JSON.parse(output);
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function killMCPZombies() {
  try { execSync("pkill -f 'tradingview-mcp/src/server.js' 2>/dev/null", { timeout: 2000 }); } catch {}
}

// Read BOTH timeframes — 15min for bias, 5min for entry
function readChartDualTimeframe() {
  const results = { tf15: {}, tf5: {} };

  // ── 1. Switch to 15min → read bias + structure ──
  runMCPTool('chart_set_timeframe', '{"timeframe":"15"}');
  results.tf15.quote = runMCPTool('quote_get');
  results.tf15.studies = runMCPTool('data_get_study_values');
  results.tf15.labels = runMCPTool('data_get_pine_labels', '{"study_filter":"Price Action","max_labels":10}');
  killMCPZombies();

  // ── 2. Switch to 5min → read entry signals ──
  runMCPTool('chart_set_timeframe', '{"timeframe":"5"}');
  // Wait for chart to load new timeframe data
  const waitUntil = Date.now() + 2000;
  while (Date.now() < waitUntil) {}
  results.tf5.studies = runMCPTool('data_get_study_values');
  killMCPZombies();

  return results;
}

// ─── PARSE STUDY VALUES FROM ONE TIMEFRAME ───
function parseStudies(studyResult) {
  const out = {
    smartTrail: 0, trendStrength: 0,
    bullishSignal: 0, bearishSignal: 0, bullishPlus: 0, bearishPlus: 0,
    eqTop: 0, eqBottom: 0, discountTop: 0, premiumBottom: 0,
    hyperWave: 50, moneyFlow: 50, confluenceMeter: 50,
    bullOverflow: 50, bearOverflow: 50
  };

  if (!studyResult?.success) return out;

  for (const study of (studyResult.studies || [])) {
    const v = study.values;
    const p = (key) => parseFloat((v[key] || '0').replace(/,/g, '').replace('−', '-'));

    if (study.name.includes('Signals & Overlays')) {
      out.smartTrail = p('Smart Trail');
      out.trendStrength = p('Trend Strength');
      out.bullishSignal = p('Bullish');
      out.bearishSignal = p('Bearish');
      out.bullishPlus = p('Bullish+');
      out.bearishPlus = p('Bearish+');
    }
    if (study.name.includes('Price Action Concepts')) {
      out.eqTop = p('Equilibrium Top');
      out.eqBottom = p('Equilibrium Bottom');
      out.discountTop = p('Discount Top');
      out.premiumBottom = p('Premium Bottom');
    }
    if (study.name.includes('Oscillator Matrix')) {
      out.hyperWave = p('HyperWave');
      out.moneyFlow = p('Money Flow');
      out.confluenceMeter = p('Confluence Meter Value');
      out.bullOverflow = p('Bullish Overflow');
      out.bearOverflow = p('Bearish Overflow');
    }
  }
  return out;
}

// ─── PARSE DUAL TIMEFRAME DATA ───
function parseIndicators(dualResults) {
  // Price from 15min quote
  const price = dualResults.tf15.quote?.close || dualResults.tf15.quote?.last || 0;

  // 15min = bias, structure, zones
  const tf15 = parseStudies(dualResults.tf15.studies);

  // 5min = entry signals, oscillator precision
  const tf5 = parseStudies(dualResults.tf5.studies);

  // Structure labels from 15min PAC
  const labels = dualResults.tf15.labels?.studies?.[0]?.labels || [];

  // Merge: use 15min for structure/zones, 5min for signals/oscillator
  return {
    price,
    // 15min — bias & structure
    smartTrail: tf15.smartTrail,
    trendStrength: tf15.trendStrength,
    eqTop: tf15.eqTop,
    eqBottom: tf15.eqBottom,
    discountTop: tf15.discountTop,
    premiumBottom: tf15.premiumBottom,
    // 5min — signals & momentum (more reactive)
    bullishSignal: tf5.bullishSignal,
    bearishSignal: tf5.bearishSignal,
    bullishPlus: tf5.bullishPlus,
    bearishPlus: tf5.bearishPlus,
    hyperWave: tf5.hyperWave,
    moneyFlow: tf5.moneyFlow,
    confluenceMeter: tf5.confluenceMeter,
    bullOverflow: tf5.bullOverflow,
    bearOverflow: tf5.bearOverflow,
    // Hybrid: use 5min trend strength too for comparison
    trendStrength5m: tf5.trendStrength,
    smartTrail5m: tf5.smartTrail,
    // Raw for logging
    tf15, tf5, labels
  };
}

// ─── CONFLUENCE SCORE (0-100) ───
// Combines all 3 indicators into a single directional score
function calculateConfluence(data, direction) {
  let score = 0;
  const reasons = [];

  if (direction === 'SHORT') {
    // Signals & Overlays (max 35 pts)
    if (data.price < data.smartTrail)          { score += 10; reasons.push('Below Smart Trail'); }
    if (data.trendStrength > 5)                { score += 5; reasons.push(`Trend ${data.trendStrength.toFixed(0)}`); }
    if (data.bearishSignal > 0)                { score += 15; reasons.push('Bearish signal'); }
    if (data.bearishPlus > 0)                  { score += 20; reasons.push('Bearish+ signal'); }

    // Price Action Concepts (max 25 pts)
    if (data.price >= data.eqBottom && data.price <= data.eqTop) { score += 15; reasons.push('In EQ zone'); }
    if (data.price >= data.premiumBottom)       { score += 10; reasons.push('In premium'); }

    // Oscillator Matrix (max 40 pts)
    if (data.hyperWave > 70)                   { score += 10; reasons.push(`HyperWave overbought ${data.hyperWave.toFixed(0)}`); }
    if (data.hyperWave > 80)                   { score += 5; reasons.push('HyperWave extreme'); }
    if (data.moneyFlow < 45)                   { score += 10; reasons.push(`Money outflow ${data.moneyFlow.toFixed(0)}`); }
    if (data.confluenceMeter < 40)             { score += 10; reasons.push(`Confluence bearish ${data.confluenceMeter.toFixed(0)}`); }
    if (data.bearOverflow > 55)                { score += 5; reasons.push('Bear overflow'); }

  } else { // LONG
    // Signals & Overlays (max 35 pts)
    if (data.price > data.smartTrail)          { score += 10; reasons.push('Above Smart Trail'); }
    if (data.trendStrength > 5)                { score += 5; reasons.push(`Trend ${data.trendStrength.toFixed(0)}`); }
    if (data.bullishSignal > 0)                { score += 15; reasons.push('Bullish signal'); }
    if (data.bullishPlus > 0)                  { score += 20; reasons.push('Bullish+ signal'); }

    // Price Action Concepts (max 25 pts)
    if (data.price >= data.eqBottom && data.price <= data.eqTop) { score += 15; reasons.push('In EQ zone'); }
    if (data.price <= data.discountTop)        { score += 10; reasons.push('In discount'); }

    // Oscillator Matrix (max 40 pts)
    if (data.hyperWave < 30)                   { score += 10; reasons.push(`HyperWave oversold ${data.hyperWave.toFixed(0)}`); }
    if (data.hyperWave < 20)                   { score += 5; reasons.push('HyperWave extreme'); }
    if (data.moneyFlow > 55)                   { score += 10; reasons.push(`Money inflow ${data.moneyFlow.toFixed(0)}`); }
    if (data.confluenceMeter > 60)             { score += 10; reasons.push(`Confluence bullish ${data.confluenceMeter.toFixed(0)}`); }
    if (data.bullOverflow > 55)                { score += 5; reasons.push('Bull overflow'); }
  }

  return { score: Math.min(score, 100), reasons };
}

// ─── EVALUATE ENTRY ───
function evaluate(data, config) {
  const z = config.zones;
  const p = data.price;

  // Calculate confluence scores for both directions
  const shortConf = calculateConfluence(data, 'SHORT');
  const longConf = calculateConfluence(data, 'LONG');

  // SHORT: needs score >= 40 AND price in/near zone
  const shortInZone = (p >= z.short_entry_bottom - 15 && p <= z.short_entry_top + 5) ||
                      (p >= data.eqBottom && p <= data.eqTop);
  const shortTriggered = shortConf.score >= 40 && (shortInZone || data.bearishSignal > 0 || data.bearishPlus > 0);

  // LONG: needs score >= 40 AND price in/near zone
  const longInZone = (p >= z.long_entry_bottom - 5 && p <= z.long_entry_top + 15);
  const longTriggered = longConf.score >= 40 && (longInZone || data.bullishSignal > 0 || data.bullishPlus > 0);

  return { shortTriggered, longTriggered, shortConf, longConf };
}

function managePosition(data, config, state) {
  const z = config.zones;
  const p = data.price;
  const trail = data.smartTrail;
  const trend = data.trendStrength;
  let changed = false;

  // ── 1. STRUCTURE FLIP DETECTION ──
  // If trend strength drops below 3 or flips direction, exit the trade
  if (state.direction === 'SHORT' && p > trail && trend < 4) {
    log(`⚠️ STRUCTURE FLIP — price ${p} above Smart Trail ${trail}, trend weak ${trend}. Closing SHORT.`);
    const id = `flip-${Date.now()}`;
    writeMT5Signal({ symbol: 'XAUUSD', event: 'CLOSE', id });
    readMT5Ack(id, 5000);
    state.open_position = false; state.direction = ''; state.entry_price = 0;
    state.tp1_hit = false; state.tp2_hit = false;
    saveState(state);
    sendTelegram('exit', { symbol: 'GOLD', direction: 'SHORT', entryPrice: String(state.entry_price), exitPrice: String(p), pnl: 0, pnlPct: '-', reason: `Structure flip — price broke above Smart Trail (${trail}) with weakening trend (${trend}/10). Auto-exit to protect capital.` });
    sendTelegram('custom', `⚠️ Auto-trader: SHORT closed — structure flipped bullish. Price ${p} > Trail ${trail}. @saieswarboda`);
    return;
  }
  if (state.direction === 'LONG' && p < trail && trend < 4) {
    log(`⚠️ STRUCTURE FLIP — price ${p} below Smart Trail ${trail}, trend weak ${trend}. Closing LONG.`);
    const id = `flip-${Date.now()}`;
    writeMT5Signal({ symbol: 'XAUUSD', event: 'CLOSE', id });
    readMT5Ack(id, 5000);
    state.open_position = false; state.direction = ''; state.entry_price = 0;
    state.tp1_hit = false; state.tp2_hit = false;
    saveState(state);
    sendTelegram('exit', { symbol: 'GOLD', direction: 'LONG', entryPrice: String(state.entry_price), exitPrice: String(p), pnl: 0, pnlPct: '-', reason: `Structure flip — price broke below Smart Trail (${trail}) with weakening trend (${trend}/10). Auto-exit.` });
    sendTelegram('custom', `⚠️ Auto-trader: LONG closed — structure flipped bearish. Price ${p} < Trail ${trail}. @saieswarboda`);
    return;
  }

  // ── 2. SMART EXIT — Oscillator + Confluence Exhaustion ──
  const exitReasons = [];
  let exitScore = 0;
  const entryPrice = state.entry_price;
  const pnlPerOz = state.direction === 'LONG' ? (p - entryPrice) : (entryPrice - p);
  const inProfit = pnlPerOz > 0;

  if (state.direction === 'LONG') {
    // Exit LONG signals
    if (data.hyperWave > 85)                     { exitScore += 25; exitReasons.push(`HyperWave overbought ${data.hyperWave.toFixed(0)}`); }
    if (data.hyperWave > 80 && data.hyperWave < (state.prev_hyperWave || 100)) { exitScore += 15; exitReasons.push('HyperWave turning down'); }
    if (data.moneyFlow < 40)                     { exitScore += 20; exitReasons.push(`Money outflow ${data.moneyFlow.toFixed(0)}`); }
    if (data.confluenceMeter < 35)               { exitScore += 15; exitReasons.push(`Confluence bearish ${data.confluenceMeter.toFixed(0)}`); }
    if (data.bearishSignal > 0)                  { exitScore += 30; exitReasons.push('LuxAlgo Bearish signal fired'); }
    if (data.bearishPlus > 0)                    { exitScore += 40; exitReasons.push('LuxAlgo Bearish+ signal fired'); }
    if (data.bearOverflow > 60)                  { exitScore += 10; exitReasons.push('Bearish overflow'); }
    if (data.price >= data.premiumBottom && data.premiumBottom > 0) { exitScore += 10; exitReasons.push('Entered premium zone'); }
  } else {
    // Exit SHORT signals
    if (data.hyperWave < 15)                     { exitScore += 25; exitReasons.push(`HyperWave oversold ${data.hyperWave.toFixed(0)}`); }
    if (data.hyperWave < 20 && data.hyperWave > (state.prev_hyperWave || 0)) { exitScore += 15; exitReasons.push('HyperWave turning up'); }
    if (data.moneyFlow > 60)                     { exitScore += 20; exitReasons.push(`Money inflow ${data.moneyFlow.toFixed(0)}`); }
    if (data.confluenceMeter > 65)               { exitScore += 15; exitReasons.push(`Confluence bullish ${data.confluenceMeter.toFixed(0)}`); }
    if (data.bullishSignal > 0)                  { exitScore += 30; exitReasons.push('LuxAlgo Bullish signal fired'); }
    if (data.bullishPlus > 0)                    { exitScore += 40; exitReasons.push('LuxAlgo Bullish+ signal fired'); }
    if (data.bullOverflow > 60)                  { exitScore += 10; exitReasons.push('Bullish overflow'); }
    if (data.price <= data.discountTop && data.discountTop > 0) { exitScore += 10; exitReasons.push('Entered discount zone'); }
  }

  // Save for next scan comparison
  state.prev_hyperWave = data.hyperWave;

  // Exit thresholds:
  // - In profit + exit score >= 50 → close to lock profit (momentum exhausted)
  // - Any position + exit score >= 70 → strong reversal signal, close regardless
  // - In profit + opposite signal fired (Bearish for long, Bullish for short) → close immediately
  const hasOppositeSignal = (state.direction === 'LONG' && (data.bearishSignal > 0 || data.bearishPlus > 0)) ||
                            (state.direction === 'SHORT' && (data.bullishSignal > 0 || data.bullishPlus > 0));

  if ((inProfit && exitScore >= 50) || exitScore >= 70 || (inProfit && hasOppositeSignal)) {
    const exitType = hasOppositeSignal ? 'REVERSAL SIGNAL' : exitScore >= 70 ? 'STRONG REVERSAL' : 'MOMENTUM EXHAUSTED';
    log(`🚪 SMART EXIT (${exitType}) — score ${exitScore}/100 | P&L: $${pnlPerOz.toFixed(2)}/oz`);
    log(`   Reasons: ${exitReasons.join(', ')}`);

    const id = `smart-exit-${Date.now()}`;
    writeMT5Signal({ symbol: 'XAUUSD', event: 'CLOSE', id });
    readMT5Ack(id, 5000);

    const pnlPct = ((pnlPerOz / entryPrice) * 100).toFixed(2);
    state.open_position = false; state.direction = ''; state.entry_price = 0;
    state.tp1_hit = false; state.tp2_hit = false; state.current_sl = 0;
    saveState(state);

    sendTelegram('exit', {
      symbol: 'GOLD', direction: state.direction || '-',
      entryPrice: String(entryPrice), exitPrice: String(p),
      pnl: Math.round(pnlPerOz * 100) / 100,
      pnlPct: `${pnlPerOz >= 0 ? '+' : ''}${pnlPct}%`,
      reason: `${exitType} (score ${exitScore}/100): ${exitReasons.join(', ')}`
    });
    sendTelegram('custom', `🚪 Smart Exit: ${exitType} | ${inProfit ? '✅ Profit' : '❌ Loss'} $${pnlPerOz.toFixed(2)}/oz | Score ${exitScore}/100 | ${exitReasons.slice(0,3).join(', ')} @saieswarboda`);
    return;
  }

  if (exitScore > 0) {
    log(`📊 Exit pressure: ${exitScore}/100 [${exitReasons.join(', ')}] — not enough to exit yet`);
  }

  // ── 3. SMART TRAIL TRAILING STOP ──
  // After TP1 hit, trail SL to Smart Trail (with $5 buffer) instead of static BE
  if (state.tp1_hit) {
    const currentSL = state.current_sl || state.entry_price;
    let newSL = currentSL;

    if (state.direction === 'SHORT') {
      // For shorts: trail SL DOWN — Smart Trail is above price, so use it as ceiling
      // Only tighten SL (move it lower) if price moved significantly in our favor
      const profitFromEntry = state.entry_price - p;
      if (profitFromEntry > 20) {
        // Trail to entry price minus half the profit (lock in 50% of gains)
        const trailSL = state.entry_price - (profitFromEntry * 0.4);
        if (trailSL < currentSL) {
          newSL = Math.round(trailSL * 100) / 100;
        }
      }
    } else {
      // For longs: trail SL UP
      const profitFromEntry = p - state.entry_price;
      if (profitFromEntry > 20) {
        const trailSL = state.entry_price + (profitFromEntry * 0.4);
        if (trailSL > currentSL) {
          newSL = Math.round(trailSL * 100) / 100;
        }
      }
    }

    if (newSL !== currentSL) {
      log(`📈 TRAILING SL: ${currentSL} → ${newSL} (locking ${state.direction === 'SHORT' ? 'short' : 'long'} profit)`);
      writeMT5Signal({ symbol: 'XAUUSD', event: 'MODIFY', sl_price: newSL });
      state.current_sl = newSL;
      changed = true;
      sendTelegram('custom', `📈 SL trailed: ${currentSL} → ${newSL} | ${state.direction} GOLD @ ${p} | Locking profit. @saieswarboda`);
    }
  }

  // ── 3. TP MANAGEMENT (same as before but enhanced) ──
  if (state.direction === 'SHORT') {
    if (!state.tp1_hit && p <= z.short_tp1) {
      log(`🎯 TP1 HIT @ ${p}`);
      state.tp1_hit = true;
      const id1 = `tp1-${Date.now()}`;
      writeMT5Signal({ symbol: 'XAUUSD', event: 'PARTIAL_CLOSE', percent: config.management.tp1_close_percent, id: id1 });
      readMT5Ack(id1, 5000);
      // Move SL to breakeven
      state.current_sl = state.entry_price;
      writeMT5Signal({ symbol: 'XAUUSD', event: 'MODIFY', sl_price: state.entry_price, tp_price: z.short_tp2 });
      sendTelegram('tp', { symbol: 'GOLD', direction: 'SHORT', tpLevel: 'TP1', tpPrice: String(z.short_tp1), partialClose: `${config.management.tp1_close_percent}% closed`, remaining: 'Running to TP2' });
      changed = true;
    }
    if (state.tp1_hit && !state.tp2_hit && p <= z.short_tp2) {
      log(`🎯 TP2 HIT @ ${p}`);
      state.tp2_hit = true;
      writeMT5Signal({ symbol: 'XAUUSD', event: 'PARTIAL_CLOSE', percent: 50 });
      sendTelegram('tp', { symbol: 'GOLD', direction: 'SHORT', tpLevel: 'TP2', tpPrice: String(z.short_tp2), partialClose: '50% remaining closed', remaining: 'Runner to TP3' });
      changed = true;
    }
  }
  if (state.direction === 'LONG') {
    if (!state.tp1_hit && p >= z.long_tp1) {
      log(`🎯 TP1 HIT @ ${p}`);
      state.tp1_hit = true;
      writeMT5Signal({ symbol: 'XAUUSD', event: 'PARTIAL_CLOSE', percent: config.management.tp1_close_percent });
      state.current_sl = state.entry_price;
      writeMT5Signal({ symbol: 'XAUUSD', event: 'MODIFY', sl_price: state.entry_price, tp_price: z.long_tp2 });
      sendTelegram('tp', { symbol: 'GOLD', direction: 'LONG', tpLevel: 'TP1', tpPrice: String(z.long_tp1), partialClose: `${config.management.tp1_close_percent}% closed`, remaining: 'Running to TP2' });
      changed = true;
    }
    if (state.tp1_hit && !state.tp2_hit && p >= z.long_tp2) {
      log(`🎯 TP2 HIT @ ${p}`);
      state.tp2_hit = true;
      writeMT5Signal({ symbol: 'XAUUSD', event: 'PARTIAL_CLOSE', percent: 50 });
      sendTelegram('tp', { symbol: 'GOLD', direction: 'LONG', tpLevel: 'TP2', tpPrice: String(z.long_tp2), partialClose: '50% remaining closed', remaining: 'Runner to TP3' });
      changed = true;
    }
  }

  // ── 4. DYNAMIC ZONE UPDATE (every 6th scan ≈ every 30 min) ──
  const scanCount = state.scan_count || 0;
  state.scan_count = scanCount + 1;

  if (scanCount % 6 === 0 && scanCount > 0) {
    log(`🔄 Updating zones from LuxAlgo (scan #${scanCount})`);
    // Update zones from live LuxAlgo readings
    const cfg = loadConfig();
    if (state.direction === 'SHORT') {
      // Update short TPs based on current EQ/discount levels
      if (data.eqBottom > 0 && data.eqBottom < cfg.zones.short_entry_bottom) {
        cfg.zones.short_tp1 = Math.round(data.eqBottom * 100) / 100;
        log(`  Updated short TP1 → ${cfg.zones.short_tp1} (EQ bottom)`);
      }
      if (data.discountTop > 0 && data.discountTop < cfg.zones.short_tp2) {
        cfg.zones.short_tp2 = Math.round(data.discountTop * 100) / 100;
        log(`  Updated short TP2 → ${cfg.zones.short_tp2} (discount top)`);
      }
    } else {
      // Update long TPs based on current EQ/premium levels
      if (data.eqTop > 0 && data.eqTop > cfg.zones.long_tp1) {
        cfg.zones.long_tp1 = Math.round(data.eqTop * 100) / 100;
        log(`  Updated long TP1 → ${cfg.zones.long_tp1} (EQ top)`);
      }
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }

  if (changed) saveState(state);
}

// ─── MAIN ───
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  log('═══ AUTO-TRADER LITE ' + (dryRun ? '(DRY)' : '(LIVE)') + ' ═══');

  const config = loadConfig();
  const state = loadState();

  // Pre-flight
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  const today = now.toISOString().slice(0, 10);

  if (!config.enabled) { log('SKIP: Disabled'); return; }
  if (config.schedule.skip_weekends && (day === 0 || day === 6)) { log('SKIP: Weekend'); return; }
  if (!config.schedule.active_hours_utc.includes(hour)) { log(`SKIP: Hour ${hour} UTC`); return; }
  if (state.last_trade_date !== today) { state.trades_today = 0; state.daily_pnl = 0; state.last_trade_date = today; saveState(state); }
  if (state.trades_today >= config.risk.max_trades_per_day) { log('SKIP: Max trades'); return; }
  if (state.daily_pnl <= -config.risk.max_daily_loss_usd) { log('SKIP: Max loss'); return; }

  // Pre-flight: verify TradingView CDP is reachable
  const cdpWsUrl = await getChartPageWs();
  if (!cdpWsUrl) {
    log('ERROR: TradingView not running or CDP not enabled (localhost:9222 unreachable)');
    sendTelegram('custom', '⚠️ Auto-trader: TradingView not running — scan skipped. Start TV with CDP enabled. @saieswarboda');
    return;
  }

  // Read BOTH timeframes
  log('Reading 15min + 5min...');
  const dualResults = readChartDualTimeframe();
  const data = parseIndicators(dualResults);

  if (!data.price) { log('ERROR: No price data (quote_get returned 0 — check chart symbol)'); return; }

  log(`Price: ${data.price}`);
  log(`15min: Trail ${data.smartTrail} | Trend ${data.trendStrength} | EQ ${data.eqBottom}-${data.eqTop}`);
  log(`5min:  Trail ${data.smartTrail5m} | Trend ${data.trendStrength5m} | Bull ${data.bullishSignal} | Bear ${data.bearishSignal}`);
  log(`5min Osc: HyperWave ${data.hyperWave.toFixed(1)} | MoneyFlow ${data.moneyFlow.toFixed(1)} | Confluence ${data.confluenceMeter.toFixed(1)}`);

  // Check if MT5 position still exists (broker may have closed it via SL/TP)
  if (state.open_position) {
    try {
      const ack = JSON.parse(fs.readFileSync(path.join(MT5_FILES, 'ack.json'), 'utf8'));
      // If last ack is a CLOSE/PARTIAL_CLOSED and both TPs hit, position is likely gone
      if (state.tp1_hit && state.tp2_hit && (ack.status === 'CLOSED' || ack.status === 'PARTIAL_CLOSED')) {
        log(`📋 Position likely closed by broker (TP1+TP2 hit, last ack: ${ack.status}). Resetting state.`);
        state.open_position = false; state.direction = ''; state.entry_price = 0;
        state.tp1_hit = false; state.tp2_hit = false;
        saveState(state);
        sendTelegram('custom', `📋 Auto-trader: Position closed (TP1+TP2 hit). Ready for next setup. @saieswarboda`);
      }
    } catch {}
  }

  // Manage open position
  if (state.open_position) {
    log(`Managing ${state.direction} from ${state.entry_price}`);
    managePosition(data, config, state);
    return;
  }

  // Evaluate entry with confluence scoring
  const { shortTriggered, longTriggered, shortConf, longConf } = evaluate(data, config);

  log(`SHORT score: ${shortConf.score}/100 [${shortConf.reasons.join(', ')}]`);
  log(`LONG score:  ${longConf.score}/100 [${longConf.reasons.join(', ')}]`);

  if (shortTriggered) {
    log(`🟢 SHORT TRIGGERED (score: ${shortConf.score})`);
    if (dryRun) { log('DRY RUN — skipping'); return; }
    const z = config.zones;
    const id = `entry-${Date.now()}`;
    writeMT5Signal({ symbol: 'XAUUSD', event: 'ENTRY', direction: 'SELL', lot: config.risk.lot_size, sl_price: z.short_sl, tp_price: z.short_tp1, id });
    const ack = readMT5Ack(id);
    if (ack?.status === 'EXECUTED') {
      state.open_position = true; state.direction = 'SHORT'; state.entry_price = ack.price || data.price;
      state.trades_today++; state.tp1_hit = false; state.tp2_hit = false; state.current_sl = z.short_sl; state.scan_count = 0; saveState(state);
      writeMT5Signal({ symbol: 'XAUUSD', event: 'MODIFY', sl_price: z.short_sl, tp_price: z.short_tp1 });
      sendTelegram('entry', {
        direction: 'SHORT', symbol: 'GOLD', entry: String(ack.price),
        sl: String(z.short_sl), tp1: String(z.short_tp1), tp2: String(z.short_tp2), tp3: String(z.short_tp3),
        timeframe: '5m/15m',
        riskReward: `${(Math.abs(data.price - z.short_tp1) / Math.abs(data.price - z.short_sl)).toFixed(1)}:1`,
        reason: `Confluence Score: ${shortConf.score}/100 | HyperWave: ${data.hyperWave.toFixed(0)} | MoneyFlow: ${data.moneyFlow.toFixed(0)} | Trail: ${data.smartTrail} | Trend: ${data.trendStrength.toFixed(0)}`,
        confluence: shortConf.reasons
      });
      log(`✅ SHORT executed @ ${ack.price} | Confluence: ${shortConf.score}/100`);
    } else { log(`❌ Failed: ${ack?.status || 'timeout'}`); }
  } else if (longTriggered) {
    log(`🟢 LONG TRIGGERED (score: ${longConf.score})`);
    if (dryRun) { log('DRY RUN — skipping'); return; }
    const z = config.zones;
    const id = `entry-${Date.now()}`;
    writeMT5Signal({ symbol: 'XAUUSD', event: 'ENTRY', direction: 'BUY', lot: config.risk.lot_size, sl_price: z.long_sl, tp_price: z.long_tp1, id });
    const ack = readMT5Ack(id);
    if (ack?.status === 'EXECUTED') {
      state.open_position = true; state.direction = 'LONG'; state.entry_price = ack.price || data.price;
      state.trades_today++; state.tp1_hit = false; state.tp2_hit = false; state.current_sl = z.long_sl; state.scan_count = 0; saveState(state);
      writeMT5Signal({ symbol: 'XAUUSD', event: 'MODIFY', sl_price: z.long_sl, tp_price: z.long_tp1 });
      sendTelegram('entry', {
        direction: 'LONG', symbol: 'GOLD', entry: String(ack.price),
        sl: String(z.long_sl), tp1: String(z.long_tp1), tp2: String(z.long_tp2), tp3: String(z.long_tp3),
        timeframe: '5m/15m',
        riskReward: `${(Math.abs(data.price - z.long_tp1) / Math.abs(data.price - z.long_sl)).toFixed(1)}:1`,
        reason: `Confluence Score: ${longConf.score}/100 | HyperWave: ${data.hyperWave.toFixed(0)} | MoneyFlow: ${data.moneyFlow.toFixed(0)} | Trail: ${data.smartTrail} | Trend: ${data.trendStrength.toFixed(0)}`,
        confluence: longConf.reasons
      });
      log(`✅ LONG executed @ ${ack.price} | Confluence: ${longConf.score}/100`);
    } else { log(`❌ Failed: ${ack?.status || 'timeout'}`); }
  } else {
    log('No setup — standing aside');
  }
}

main().catch(e => log(`FATAL: ${e.message}`));
