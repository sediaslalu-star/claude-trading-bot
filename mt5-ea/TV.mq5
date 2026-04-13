#property strict
#property description "TradingView Signal Trader v2"
#property copyright "tv-mt5-bridge"

input double InpDefaultLot    = 0.1;
input int    InpPollMs        = 100;
input int    InpSlippagePts   = 30;
input string InpSecret        = "test123";
input int    InpMagicNumber   = 123456;

string last_id = "";
string g_symbol = "";

// Store entry price for P&L tracking
double g_entryPrice = 0;
string g_entryDir = "";

string NormalizeSymbol(const string sym)
{
   string s = sym;
   StringToUpper(s);
   int dotPos = StringFind(s, ".");
   if(dotPos > 0)
      s = StringSubstr(s, 0, dotPos);
   if(s == "GOLD") s = "XAUUSD";
   return s;
}

bool SymbolMatches(const string signalSymbol, const string chartSymbol)
{
   return NormalizeSymbol(signalSymbol) == NormalizeSymbol(chartSymbol);
}

string ReadFileAll(const string filename)
{
   int h = FileOpen(filename, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return "";
   string txt = "";
   while(!FileIsEnding(h))
      txt += FileReadString(h) + "\n";
   FileClose(h);
   return txt;
}

void WriteAck(const string id, const string status, const string symbol, const string direction,
              double lot, double price, ulong ticket, const string errorMsg = "")
{
   int h = FileOpen("ack.json", FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
   {
      Print("Failed to write ack.json");
      return;
   }

   string timeStr = TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS);
   StringReplace(timeStr, ".", "-");

   string json = "{\n";
   json += "  \"id\": \"" + id + "\",\n";
   json += "  \"status\": \"" + status + "\",\n";
   json += "  \"symbol\": \"" + symbol + "\",\n";
   json += "  \"direction\": \"" + direction + "\",\n";
   json += "  \"lot\": " + DoubleToString(lot, 2) + ",\n";
   json += "  \"price\": " + DoubleToString(price, 5) + ",\n";
   json += "  \"ticket\": " + IntegerToString(ticket) + ",\n";
   if(errorMsg != "")
      json += "  \"error\": \"" + errorMsg + "\",\n";
   json += "  \"time\": \"" + timeStr + "\"\n";
   json += "}";

   FileWriteString(h, json);
   FileClose(h);
   Print("ACK written: ", status, " ", symbol, " ", direction, " ticket:", ticket);
}

bool JsonGetString(const string json, const string key, string &out)
{
   string pat = "\"" + key + "\"";
   int i = StringFind(json, pat);
   if(i < 0) return false;
   i = StringFind(json, ":", i);
   if(i < 0) return false;
   i++;
   int len = StringLen(json);
   while(i < len && StringGetCharacter(json, i) == ' ') i++;
   if(i >= len || StringGetCharacter(json, i) != '"') return false;
   i++;
   int j = StringFind(json, "\"", i);
   if(j < 0) return false;
   out = StringSubstr(json, i, j - i);
   return true;
}

bool JsonGetNumber(const string json, const string key, double &out)
{
   string pat = "\"" + key + "\"";
   int i = StringFind(json, pat);
   if(i < 0) return false;
   i = StringFind(json, ":", i);
   if(i < 0) return false;
   i++;
   int len = StringLen(json);
   while(i < len && StringGetCharacter(json, i) == ' ') i++;
   int j = i;
   ushort c;
   while(j < len)
   {
      c = StringGetCharacter(json, j);
      if((c >= '0' && c <= '9') || c == '.' || c == '-')
      {
         j++;
         continue;
      }
      break;
   }
   if(j == i) return false;
   out = StringToDouble(StringSubstr(json, i, j - i));
   return true;
}

bool HasOpenPosition(const string sym)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetString(POSITION_SYMBOL) == sym)
            return true;
      }
   }
   return false;
}

ENUM_ORDER_TYPE_FILLING GetFillingMode(const string sym)
{
   long filling_mode = SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
   if((filling_mode & SYMBOL_FILLING_FOK) == SYMBOL_FILLING_FOK)
      return ORDER_FILLING_FOK;
   else if((filling_mode & SYMBOL_FILLING_IOC) == SYMBOL_FILLING_IOC)
      return ORDER_FILLING_IOC;
   else
      return ORDER_FILLING_RETURN;
}

// Close a specific percentage of position volume
bool ClosePartial(const string sym, double pct, const string id)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != sym) continue;

      double totalVol = PositionGetDouble(POSITION_VOLUME);
      double closeVol = NormalizeDouble(totalVol * (pct / 100.0), 2);
      double minLot = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);

      // Ensure at least min lot, or close all if remainder would be below min
      if(closeVol < minLot) closeVol = minLot;
      if(totalVol - closeVol < minLot) closeVol = totalVol;

      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string posDir = (posType == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      MqlTradeRequest req = {};
      MqlTradeResult res = {};

      req.action       = TRADE_ACTION_DEAL;
      req.symbol       = sym;
      req.volume       = closeVol;
      req.deviation    = InpSlippagePts;
      req.magic        = InpMagicNumber;
      req.position     = ticket;
      req.type_filling = GetFillingMode(sym);

      double closePrice = 0;
      if(posType == POSITION_TYPE_BUY)
      {
         req.type  = ORDER_TYPE_SELL;
         closePrice = SymbolInfoDouble(sym, SYMBOL_BID);
      }
      else
      {
         req.type  = ORDER_TYPE_BUY;
         closePrice = SymbolInfoDouble(sym, SYMBOL_ASK);
      }
      req.price = closePrice;

      bool ok = OrderSend(req, res);
      if(!ok || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
      {
         WriteAck(id, "PARTIAL_CLOSE_FAILED", sym, posDir, closeVol, closePrice, ticket,
                  "retcode:" + IntegerToString(res.retcode));
         return false;
      }
      else
      {
         double remaining = totalVol - closeVol;
         Print("Partial close ", closeVol, " of ", totalVol, " (", pct, "%), remaining: ", remaining);
         WriteAck(id, "PARTIAL_CLOSED", sym, posDir, closeVol, closePrice, ticket);
         return true;
      }
   }

   WriteAck(id, "NO_POSITION", sym, "-", 0, 0, 0, "No open position for partial close");
   return false;
}

// Modify SL/TP on open position
bool ModifyPosition(const string sym, double newSL, double newTP, const string id)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != sym) continue;

      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

      MqlTradeRequest req = {};
      MqlTradeResult res = {};

      req.action   = TRADE_ACTION_SLTP;
      req.symbol   = sym;
      req.position = ticket;

      if(newSL > 0) req.sl = NormalizeDouble(newSL, digits);
      else req.sl = PositionGetDouble(POSITION_SL);

      if(newTP > 0) req.tp = NormalizeDouble(newTP, digits);
      else req.tp = PositionGetDouble(POSITION_TP);

      bool ok = OrderSend(req, res);
      if(!ok || res.retcode != TRADE_RETCODE_DONE)
      {
         WriteAck(id, "MODIFY_FAILED", sym, "-", 0, 0, ticket,
                  "retcode:" + IntegerToString(res.retcode));
         return false;
      }
      else
      {
         Print("Modified position SL:", req.sl, " TP:", req.tp);
         WriteAck(id, "MODIFIED", sym, "-", 0, PositionGetDouble(POSITION_PRICE_OPEN), ticket);
         return true;
      }
   }

   WriteAck(id, "NO_POSITION", sym, "-", 0, 0, 0, "No position to modify");
   return false;
}

bool CloseAllPositions(const string sym, const string id)
{
   bool allClosed = true;
   int closedCount = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != sym) continue;

      double volume = PositionGetDouble(POSITION_VOLUME);
      ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
      string posDir = (posType == POSITION_TYPE_BUY) ? "BUY" : "SELL";

      MqlTradeRequest req = {};
      MqlTradeResult res = {};

      req.action       = TRADE_ACTION_DEAL;
      req.symbol       = sym;
      req.volume       = volume;
      req.deviation    = InpSlippagePts;
      req.magic        = InpMagicNumber;
      req.position     = ticket;
      req.type_filling = GetFillingMode(sym);

      double closePrice = 0;
      if(posType == POSITION_TYPE_BUY)
      {
         req.type  = ORDER_TYPE_SELL;
         closePrice = SymbolInfoDouble(sym, SYMBOL_BID);
      }
      else
      {
         req.type  = ORDER_TYPE_BUY;
         closePrice = SymbolInfoDouble(sym, SYMBOL_ASK);
      }
      req.price = closePrice;

      bool ok = OrderSend(req, res);
      if(!ok || (res.retcode != TRADE_RETCODE_DONE && res.retcode != TRADE_RETCODE_PLACED))
      {
         WriteAck(id, "CLOSE_FAILED", sym, posDir, volume, closePrice, ticket,
                  "retcode:" + IntegerToString(res.retcode));
         allClosed = false;
      }
      else
      {
         WriteAck(id, "CLOSED", sym, posDir, volume, closePrice, ticket);
         closedCount++;
      }
   }

   if(closedCount == 0)
      WriteAck(id, "NO_POSITION", sym, "-", 0, 0, 0, "No open position to close");

   return allClosed;
}

bool PlaceMarket(const string sym, const string dir, double lot,
                 double sl_val, double tp_val, bool usePrice,
                 const string id)
{
   if(!SymbolSelect(sym, true))
   {
      WriteAck(id, "FAILED", sym, dir, lot, 0, 0, "SymbolSelect failed");
      return false;
   }
   Sleep(100);

   double point  = SymbolInfoDouble(sym, SYMBOL_POINT);
   int digits    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double ask    = SymbolInfoDouble(sym, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(sym, SYMBOL_BID);

   if(ask == 0 || bid == 0)
   {
      WriteAck(id, "FAILED", sym, dir, lot, 0, 0, "Invalid prices");
      return false;
   }

   MqlTradeRequest req = {};
   MqlTradeResult res = {};

   req.action       = TRADE_ACTION_DEAL;
   req.symbol       = sym;
   req.volume       = lot;
   req.deviation    = InpSlippagePts;
   req.magic        = InpMagicNumber;
   req.type_filling = GetFillingMode(sym);

   double entry = 0;
   if(dir == "BUY")
   {
      req.type = ORDER_TYPE_BUY;
      entry = ask;
   }
   else
   {
      req.type = ORDER_TYPE_SELL;
      entry = bid;
   }

   req.price = NormalizeDouble(entry, digits);

   // SL/TP — accept either absolute price or points
   if(sl_val > 0)
   {
      if(usePrice)
         req.sl = NormalizeDouble(sl_val, digits);
      else
      {
         if(dir == "BUY")
            req.sl = NormalizeDouble(entry - sl_val * point, digits);
         else
            req.sl = NormalizeDouble(entry + sl_val * point, digits);
      }
   }

   if(tp_val > 0)
   {
      if(usePrice)
         req.tp = NormalizeDouble(tp_val, digits);
      else
      {
         if(dir == "BUY")
            req.tp = NormalizeDouble(entry + tp_val * point, digits);
         else
            req.tp = NormalizeDouble(entry - tp_val * point, digits);
      }
   }

   bool ok = OrderSend(req, res);
   if(!ok)
   {
      WriteAck(id, "FAILED", sym, dir, lot, entry, 0,
               "OrderSend failed: " + IntegerToString(res.retcode));
      return false;
   }

   if(res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED)
   {
      g_entryPrice = res.price > 0 ? res.price : entry;
      g_entryDir = dir;
      WriteAck(id, "EXECUTED", sym, dir, lot, g_entryPrice, res.order);
      return true;
   }
   else
   {
      WriteAck(id, "FAILED", sym, dir, lot, entry, res.order,
               "Unexpected retcode: " + IntegerToString(res.retcode));
      return false;
   }
}

void ProcessSignal()
{
   string raw = ReadFileAll("signal.json");
   if(raw == "") return;

   string secret;
   if(JsonGetString(raw, "secret", secret))
   {
      if(secret != InpSecret) return;
   }

   string symbol;
   if(!JsonGetString(raw, "symbol", symbol)) symbol = g_symbol;
   StringToUpper(symbol);

   if(!SymbolMatches(symbol, g_symbol)) return;

   string event;
   if(!JsonGetString(raw, "event", event)) event = "ENTRY";
   StringToUpper(event);

   string id;
   if(!JsonGetString(raw, "id", id))
      id = IntegerToString(StringLen(raw));

   if(id == last_id) return;

   // CLOSE event
   if(event == "CLOSE")
   {
      CloseAllPositions(g_symbol, id);
      last_id = id;
      return;
   }

   // PARTIAL_CLOSE event — close a percentage
   if(event == "PARTIAL_CLOSE")
   {
      double pct = 50;
      JsonGetNumber(raw, "percent", pct);
      ClosePartial(g_symbol, pct, id);
      last_id = id;
      return;
   }

   // MODIFY event — change SL/TP on open position
   if(event == "MODIFY")
   {
      double newSL = 0, newTP = 0;
      JsonGetNumber(raw, "sl_price", newSL);
      JsonGetNumber(raw, "tp_price", newTP);
      ModifyPosition(g_symbol, newSL, newTP, id);
      last_id = id;
      return;
   }

   // ENTRY event
   if(event != "ENTRY")
   {
      last_id = id;
      return;
   }

   string direction;
   if(!JsonGetString(raw, "direction", direction)) return;
   StringToUpper(direction);

   double lot = 0;
   if(!JsonGetNumber(raw, "lot", lot) || lot <= 0) lot = InpDefaultLot;

   // Check for price-based SL/TP first, then fall back to points
   double sl_val = 0, tp_val = 0;
   bool usePrice = false;

   if(JsonGetNumber(raw, "sl_price", sl_val) && sl_val > 0)
      usePrice = true;
   else
      JsonGetNumber(raw, "sl_points", sl_val);

   if(usePrice)
      JsonGetNumber(raw, "tp_price", tp_val);
   else
      JsonGetNumber(raw, "tp_points", tp_val);

   if(HasOpenPosition(g_symbol))
   {
      WriteAck(id, "SKIPPED", g_symbol, direction, lot, 0, 0, "Position already open");
      last_id = id;
      return;
   }

   PlaceMarket(g_symbol, direction, lot, sl_val, tp_val, usePrice, id);
   last_id = id;
}

int OnInit()
{
   g_symbol = _Symbol;
   EventSetMillisecondTimer(InpPollMs);
   Print("TV Signal Trader v2 started for ", g_symbol);
   Print("Polling signal.json every ", InpPollMs, "ms");
   Print("Supports: ENTRY, CLOSE, PARTIAL_CLOSE, MODIFY");
   Print("SL/TP: accepts sl_price/tp_price (absolute) or sl_points/tp_points");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("TV Signal Trader stopped for ", g_symbol);
}

void OnTimer()
{
   ProcessSignal();
}
