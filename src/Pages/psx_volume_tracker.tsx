import React, { useState, useEffect, useRef } from "react";
import { TrendingUp, Activity, AlertCircle, Settings } from "lucide-react";

const PSXVolumeTracker = () => {
  const [stocks, setStocks] = useState([]);
  const [surgeStocks, setSurgeStocks] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [trackedSymbols, setTrackedSymbols] = useState([]);
  const candleHistory = useRef({});
  const wsRef = useRef(null);

  // 🔹 Helper: calculate signal score (0–100)
  const calculateSignalScore = (data) => {
    const {
      currentVolume,
      intradayAvgVolume,
      last2AvgVolume,
      gainFromPrevCandle,
      gainFromDayLow,
      exceedsIntradayAvg,
      exceedsLast2Avg,
      completedCandles,
      currentCandle,
    } = data;

    let score = 0;

    // Volume Surge Strength (30)
    const volRatio = currentVolume / (intradayAvgVolume || 1);
    if (volRatio >= 3) score += 30;
    else if (volRatio >= 2) score += 22;
    else if (volRatio >= 1.5) score += 15;
    else if (volRatio >= 1.2) score += 10;

    // Price Momentum (25)
    if (gainFromPrevCandle >= 2) score += 25;
    else if (gainFromPrevCandle >= 1) score += 18;
    else if (gainFromPrevCandle >= 0.5) score += 10;
    else if (gainFromPrevCandle > 0) score += 5;

    // Price Position (20)
    const dayHigh = Math.max(
      ...completedCandles.map((c) => c.high),
      currentCandle.high
    );
    const dayLow = Math.min(
      ...completedCandles.map((c) => c.low),
      currentCandle.low
    );
    const range = dayHigh - dayLow || 1;
    const position = ((currentCandle.close - dayLow) / range) * 100;
    if (position > 90) score += 20;
    else if (position > 75) score += 15;
    else if (position > 60) score += 10;
    else if (position > 50) score += 5;

    // Volume Quality (15)
    if (exceedsIntradayAvg && exceedsLast2Avg) score += 15;
    else if (exceedsIntradayAvg || exceedsLast2Avg) score += 8;

    // Candle Consistency (10)
    const greenCandles = completedCandles
      .slice(-3)
      .filter((c) => c.close > c.open).length;
    if (greenCandles >= 3) score += 10;
    else if (greenCandles === 2) score += 7;
    else if (greenCandles === 1) score += 4;

    return Math.min(score, 100);
  };

  // 🔹 Helper: signal strength
  const getSignalStrength = (score) => {
    if (score >= 80) return "Strong";
    if (score >= 55) return "Medium";
    return "Weak";
  };

  // 🔹 Detect and count winning streaks dynamically
  const getWinningStreakCount = (completedCandles) => {
    if (!completedCandles || completedCandles.length === 0) return 0;
    let streak = 0;
    for (let i = completedCandles.length - 1; i >= 0; i--) {
      const c = completedCandles[i];
      const prev = completedCandles[i - 1];
      if (c.close > c.open && (!prev || c.close > prev.close)) streak++;
      else break;
    }
    return streak;
  };

  // 🔹 Market hours
  useEffect(() => {
    const checkMarketHours = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentMinutes = hours * 60 + minutes;
      const open = 9 * 60 + 30;
      const close = 15 * 60 + 30;
      setIsMarketOpen(currentMinutes >= open && currentMinutes < close);
      setCurrentTime(now);
    };
    checkMarketHours();
    const interval = setInterval(checkMarketHours, 60000);
    return () => clearInterval(interval);
  }, []);

  // 🔹 Fetch symbols and connect websocket
  useEffect(() => {
    const fetchStockList = async () => {
      try {
        const res = await fetch(
          "https://ielapis.u2ventures.io/api/psxApi/search/all-stocks/"
        );
        const data = await res.json();
        const symbols = Array.isArray(data.stocks)
          ? data.stocks.map((s) => (typeof s === "string" ? s : s.symbol))
          : [];
        setTrackedSymbols(symbols);
        return symbols;
      } catch (e) {
        console.error("Stock list error:", e);
        const fallback = ["PSO", "OGDC", "PPL", "HBL", "MCB"];
        setTrackedSymbols(fallback);
        return fallback;
      }
    };

    const connect = async () => {
      const symbols = await fetchStockList();
      wsRef.current = new WebSocket(
        "wss://ielapis.u2ventures.io/ws/market/feed/"
      );
      wsRef.current.onopen = () => {
        symbols.forEach((sym) =>
          wsRef.current.send(JSON.stringify({ symbol: sym }))
        );
      };
      wsRef.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.message === "Received tick" && msg.data?.type === "tick")
            processTick(msg.data.data);
        } catch (err) {
          console.error("Tick error:", err);
        }
      };
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  // 🔹 Process each tick
  const processTick = (tick) => {
    const symbol = tick.s;
    const price = tick.c;
    const volume = tick.v;
    const timestamp = new Date(tick.t * 1000);
    const ldcp = tick.ldcp || tick.pc || price;
    const change = tick.pch * 100;
    const block = Math.floor(timestamp.getTime() / (30 * 1000));

    let history = candleHistory.current[symbol];
    if (!history) {
      history = {
        currentBlock: block,
        currentCandle: {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          startVol: volume,
        },
        completedCandles: [],
        ldcp,
      };
      candleHistory.current[symbol] = history;
    }

    if (block !== history.currentBlock) {
      if (history.currentCandle.volume > 0) {
        history.completedCandles.push({ ...history.currentCandle });
        if (history.completedCandles.length > 60)
          history.completedCandles.shift();
      }
      history.currentBlock = block;
      history.currentCandle = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        startVol: volume,
      };
    }

    history.currentCandle.high = Math.max(history.currentCandle.high, price);
    history.currentCandle.low = Math.min(history.currentCandle.low, price);
    history.currentCandle.close = price;
    history.currentCandle.volume = volume - history.currentCandle.startVol;

    const stock = {
      symbol,
      price,
      volume,
      change,
      timestamp,
      ldcp,
      history,
    };

    setStocks((prev) => {
      const idx = prev.findIndex((s) => s.symbol === symbol);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = stock;
        return updated;
      } else return [...prev, stock];
    });

    const existing = surgeStocks.find((s) => s.symbol === symbol);
    if (existing) updateSurge(symbol, history, stock);
    else checkSurge(symbol, history, stock);
  };

  // ✅ New surge detection
  const checkSurge = (symbol, history, stock) => {
    const completed = history.completedCandles || [];
    const current = history.currentCandle || {};
    if (completed.length < 3) return;

    const prev = completed[completed.length - 1];
    const volNow = current.volume;
    const intradayAvg =
      completed.reduce((a, c) => a + c.volume, 0) / completed.length;
    const last2Avg = completed.slice(-2).reduce((a, c) => a + c.volume, 0) / 2;
    const exceedsIntra = volNow > intradayAvg;
    const exceedsLast2 = volNow > last2Avg;
    const priceNow = current.close;
    const gainPrev = ((priceNow - prev.close) / prev.close) * 100;
    const dayLow = Math.min(...completed.map((c) => c.low), current.low);
    const gainDay = ((priceNow - dayLow) / dayLow) * 100;

    if (exceedsIntra && exceedsLast2 && gainPrev > 0.5 && gainDay > 1) {
      const score = calculateSignalScore({
        currentVolume: volNow,
        intradayAvgVolume: intradayAvg,
        last2AvgVolume: last2Avg,
        gainFromPrevCandle: gainPrev,
        gainFromDayLow: gainDay,
        exceedsIntradayAvg: exceedsIntra,
        exceedsLast2Avg: exceedsLast2,
        completedCandles: completed,
        currentCandle: current,
      });
      const streak = getWinningStreakCount(completed);

      const surge = {
        ...stock,
        entryPrice: priceNow,
        surgeTime: new Date(),
        signalScore: score,
        signalStrength: getSignalStrength(score),
        currentVolume: volNow,
        streak,
      };

      setSurgeStocks((prev) => [
        ...prev.filter((s) => s.symbol !== symbol),
        surge,
      ]);
    }
  };

  // 🔁 Update existing surge streak
  const updateSurge = (symbol, history, stock) => {
    const completed = history.completedCandles || [];
    const current = history.currentCandle || {};
    if (completed.length < 2) return;
    const streak = getWinningStreakCount(completed);

    setSurgeStocks((prev) =>
      prev.map((s) =>
        s.symbol === symbol
          ? { ...s, price: stock.price, streak, lastUpdated: new Date() }
          : s
      )
    );
  };

  const formatVol = (v) =>
    v >= 1e6
      ? `${(v / 1e6).toFixed(2)}M`
      : v >= 1e3
      ? `${(v / 1e3).toFixed(1)}K`
      : v;

  const sorted = [...surgeStocks].sort((a, b) => b.signalScore - a.signalScore);

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between mb-6 items-center">
          <h1 className="text-2xl text-white font-bold flex items-center gap-2">
            <Activity className="text-emerald-400" /> PSX Volume + Streak
            Tracker
          </h1>
          <span
            className={`text-sm px-3 py-1 rounded-full ${
              isMarketOpen
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-red-500/20 text-red-300"
            }`}
          >
            {isMarketOpen ? "Market Open" : "Market Closed"}
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-slate-400 py-20">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No surges yet — waiting for conditions</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {sorted
              .filter(
                (stock) =>
                  stock.signalScore >= 70 && parseFloat(stock.change) < 10
              )
              .map((s) => (
                <div
                  key={s.symbol}
                  className="bg-slate-800/60 p-4 rounded-lg border border-slate-700 flex justify-between items-center hover:bg-slate-800"
                >
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      {s.symbol}
                      <span className="text-xs text-amber-300 bg-amber-500/20 px-2 py-0.5 rounded-full">
                        🔥 Streak: {s.streak}
                      </span>
                    </h2>
                    <p className="text-slate-400 text-sm">
                      Entry {s.entryPrice} • Vol {formatVol(s.currentVolume)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-bold text-lg ${
                        s.signalStrength === "Strong"
                          ? "text-emerald-400"
                          : s.signalStrength === "Medium"
                          ? "text-amber-400"
                          : "text-slate-300"
                      }`}
                    >
                      {s.signalStrength} ({s.signalScore})
                    </span>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PSXVolumeTracker;
