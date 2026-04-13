const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const BOT_TOKEN = config.telegram.bot_token;
const CHAT_ID = config.telegram.chat_id;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── SEND TEXT MESSAGE ───
function sendMessage(text, parseMode = 'MarkdownV2') {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    });

    const url = new URL(`${BASE_URL}/sendMessage`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        if (!result.ok) console.error('Telegram error:', result.description);
        resolve(result);
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── SEND PHOTO ───
function sendPhoto(photoPath, caption = '') {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const photo = fs.readFileSync(photoPath);
    const filename = path.basename(photoPath);

    let body = '';
    body += `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n`;
    if (caption) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
      body += `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`;
    }
    body += `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
    const bodyEnd = `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.concat([Buffer.from(body), photo, Buffer.from(bodyEnd)]);

    const url = new URL(`${BASE_URL}/sendPhoto`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

// ─── ESCAPE MARKDOWN V2 ───
function esc(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ─── FORMAT: TRADE ENTRY ALERT ───
function formatEntry({ direction, symbol, entry, sl, tp1, tp2, tp3, timeframe, reason, confluence, riskReward }) {
  const arrow = direction === 'LONG' ? '🟢' : '🔴';
  const dir = direction === 'LONG' ? 'LONG \\(BUY\\)' : 'SHORT \\(SELL\\)';

  return `${arrow} *NEW TRADE ALERT* ${arrow}

*${esc(symbol)}* \\| ${dir}
⏱ Timeframe: ${esc(timeframe)}

━━━━━━━━━━━━━━━━━━
📍 *Entry:* \`${esc(entry)}\`
🛑 *Stop Loss:* \`${esc(sl)}\`
🎯 *TP1:* \`${esc(tp1)}\`
🎯 *TP2:* \`${esc(tp2)}\`
${tp3 ? `🎯 *TP3:* \`${esc(tp3)}\`` : ''}
📊 *R:R:* ${esc(riskReward)}
━━━━━━━━━━━━━━━━━━

📋 *WHY THIS TRADE:*
${esc(reason)}

🔗 *CONFLUENCE:*
${confluence.map(c => `• ${esc(c)}`).join('\n')}

⚠️ _Risk 2% max \\| Move SL to BE at TP1_

@saieswarboda`;
}

// ─── FORMAT: TRADE EXIT ALERT ───
function formatExit({ symbol, direction, entryPrice, exitPrice, pnl, pnlPct, reason }) {
  const emoji = pnl >= 0 ? '✅' : '❌';
  const status = pnl >= 0 ? 'WIN' : 'LOSS';

  return `${emoji} *TRADE CLOSED — ${esc(status)}* ${emoji}

*${esc(symbol)}* \\| ${esc(direction)}

━━━━━━━━━━━━━━━━━━
📍 Entry: \`${esc(entryPrice)}\`
🚪 Exit: \`${esc(exitPrice)}\`
${pnl >= 0 ? '💰' : '💸'} *P&L:* ${esc(pnl >= 0 ? '+' : '')}$${esc(pnl)} \\(${esc(pnlPct)}\\)
━━━━━━━━━━━━━━━━━━

📋 *Exit Reason:*
${esc(reason)}

@saieswarboda`;
}

// ─── FORMAT: SL HIT ALERT ───
function formatStopLoss({ symbol, direction, entryPrice, slPrice, loss, reason }) {
  return `🛑 *STOP LOSS HIT* 🛑

*${esc(symbol)}* \\| ${esc(direction)}

━━━━━━━━━━━━━━━━━━
📍 Entry: \`${esc(entryPrice)}\`
🛑 SL Hit: \`${esc(slPrice)}\`
💸 *Loss:* \\-$${esc(loss)}
━━━━━━━━━━━━━━━━━━

📋 *What happened:*
${esc(reason)}

_Review the setup\\. Was the invalidation clear? Adjust if needed\\._

@saieswarboda`;
}

// ─── FORMAT: TP HIT ALERT ───
function formatTakeProfit({ symbol, direction, tpLevel, tpPrice, partialClose, remaining }) {
  return `🎯 *TARGET ${esc(tpLevel)} HIT* 🎯

*${esc(symbol)}* \\| ${esc(direction)}

━━━━━━━━━━━━━━━━━━
✅ *${esc(tpLevel)} reached:* \`${esc(tpPrice)}\`
📉 Closed: ${esc(partialClose)}
📊 Remaining: ${esc(remaining)}
━━━━━━━━━━━━━━━━━━

${tpLevel === 'TP1' ? '_SL moved to breakeven\\._' : ''}

@saieswarboda`;
}

// ─── FORMAT: 12HR UPDATE ───
function formatUpdate({ assets, timestamp }) {
  let msg = `📊 *12HR MARKET UPDATE*\n⏰ ${esc(timestamp)}\n\n`;

  const bullish = assets.filter(a => a.bias === 'Bullish');
  const bearish = assets.filter(a => a.bias === 'Bearish');
  const neutral = assets.filter(a => a.bias === 'Neutral');

  if (bullish.length > 0) {
    msg += `🟢 *BULLISH*\n`;
    bullish.forEach(a => {
      msg += `• *${esc(a.symbol)}* @ \`${esc(a.price)}\` — ${esc(a.note)}\n`;
    });
    msg += '\n';
  }

  if (bearish.length > 0) {
    msg += `🔴 *BEARISH*\n`;
    bearish.forEach(a => {
      msg += `• *${esc(a.symbol)}* @ \`${esc(a.price)}\` — ${esc(a.note)}\n`;
    });
    msg += '\n';
  }

  if (neutral.length > 0) {
    msg += `⚪ *NEUTRAL*\n`;
    neutral.forEach(a => {
      msg += `• *${esc(a.symbol)}* @ \`${esc(a.price)}\` — ${esc(a.note)}\n`;
    });
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━\n_Next update in 12hrs_\n\n@saieswarboda`;
  return msg;
}

// ─── CLI INTERFACE ───
async function main() {
  const action = process.argv[2];

  if (action === 'test') {
    const result = await sendMessage(esc('✅ Gold Strategy Bot is connected and working!'));
    console.log(result.ok ? 'Message sent!' : 'Failed: ' + result.description);
  }

  else if (action === 'entry') {
    const data = JSON.parse(process.argv[3]);
    await sendMessage(formatEntry(data));
    // Send screenshot if available
    if (data.screenshot && fs.existsSync(data.screenshot)) {
      await sendPhoto(data.screenshot, `📸 Chart at entry — ${data.symbol} ${data.direction}`);
    }
    console.log('Entry alert sent');
  }

  else if (action === 'exit') {
    const data = JSON.parse(process.argv[3]);
    await sendMessage(formatExit(data));
    console.log('Exit alert sent');
  }

  else if (action === 'sl') {
    const data = JSON.parse(process.argv[3]);
    await sendMessage(formatStopLoss(data));
    console.log('SL alert sent');
  }

  else if (action === 'tp') {
    const data = JSON.parse(process.argv[3]);
    await sendMessage(formatTakeProfit(data));
    console.log('TP alert sent');
  }

  else if (action === 'update') {
    const data = JSON.parse(process.argv[3]);
    await sendMessage(formatUpdate(data));
    console.log('12hr update sent');
  }

  else if (action === 'custom') {
    const text = process.argv[3];
    await sendMessage(esc(text));
    console.log('Custom message sent');
  }

  else if (action === 'photo') {
    const photoPath = process.argv[3];
    const caption = process.argv[4] || '';
    await sendPhoto(photoPath, caption);
    console.log('Photo sent');
  }

  else if (action === 'chat_id') {
    // Helper to get chat ID
    const url = `${BASE_URL}/getUpdates`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const result = JSON.parse(data);
        if (result.ok && result.result.length > 0) {
          const chatId = result.result[0].message.chat.id;
          console.log('Your chat ID:', chatId);
          console.log('Update config.json with this value');
        } else {
          console.log('No messages found. Send /start to your bot first, then retry.');
          console.log('Raw:', JSON.stringify(result));
        }
      });
    });
  }

  else {
    console.log(`
Gold Strategy Telegram Alert System
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage:
  node telegram.cjs test                    Test connection
  node telegram.cjs chat_id                 Get your chat ID
  node telegram.cjs entry '<json>'          Send trade entry alert
  node telegram.cjs exit '<json>'           Send trade exit alert
  node telegram.cjs sl '<json>'             Send stop loss hit alert
  node telegram.cjs tp '<json>'             Send take profit alert
  node telegram.cjs update '<json>'         Send 12hr update
  node telegram.cjs custom 'message'        Send custom text
  node telegram.cjs photo '/path/to/img'    Send chart screenshot

Examples:
  node telegram.cjs entry '${JSON.stringify({
    direction: "SHORT", symbol: "GOLD", entry: "4808", sl: "4822",
    tp1: "4741", tp2: "4718", tp3: "4611", timeframe: "5min/15min",
    riskReward: "4.8:1",
    reason: "Price rejected at Smart Trail (4801) + Equilibrium zone. 4H structure bearish with CHoCH+ at 4787.",
    confluence: [
      "Below 4H Smart Trail (4801)",
      "CHoCH+ bearish at 4787 (4H)",
      "Bearish signal fired on 15min",
      "Rejection at Equilibrium zone (4814-4818)",
      "Open bearish FVG above at 4961 = no demand"
    ]
  })}'

  node telegram.cjs exit '${JSON.stringify({
    symbol: "GOLD", direction: "SHORT", entryPrice: "4808", exitPrice: "4718",
    pnl: 2250, pnlPct: "+1.87%",
    reason: "TP2 hit at open bullish FVG (4718). Full target reached."
  })}'
    `);
  }
}

main().catch(console.error);
