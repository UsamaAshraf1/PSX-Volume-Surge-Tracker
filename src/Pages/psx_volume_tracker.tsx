import React, { useState, useEffect, useRef } from "react";
import { TrendingUp, Activity, AlertCircle, Settings } from "lucide-react";

const PSXVolumeTracker = () => {
  const [stocks, setStocks] = useState([]);
  const [surgeStocks, setSurgeStocks] = useState([]);
  const [exitedStocks, setExitedStocks] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [minVolume, setMinVolume] = useState(50000);
  const [surgeThreshold, setSurgeThreshold] = useState(1.2);
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

    // 1️⃣ Volume Surge Strength (30 pts)
    const volRatio = currentVolume / (intradayAvgVolume || 1);
    if (volRatio >= 3) score += 30;
    else if (volRatio >= 2) score += 22;
    else if (volRatio >= 1.5) score += 15;
    else if (volRatio >= 1.2) score += 10;

    // 2️⃣ Price Momentum (25 pts)
    if (gainFromPrevCandle >= 2) score += 25;
    else if (gainFromPrevCandle >= 1) score += 18;
    else if (gainFromPrevCandle >= 0.5) score += 10;
    else if (gainFromPrevCandle > 0) score += 5;

    // 3️⃣ Price Position vs Day Range (20 pts)
    const dayHigh = Math.max(...completedCandles.map((c) => c.high), currentCandle.high);
    const dayLow = Math.min(...completedCandles.map((c) => c.low), currentCandle.low);
    const range = dayHigh - dayLow || 1;
    const position = ((currentCandle.close - dayLow) / range) * 100;
    if (position > 90) score += 20;
    else if (position > 75) score += 15;
    else if (position > 60) score += 10;
    else if (position > 50) score += 5;

    // 4️⃣ Volume Quality (15 pts)
    if (exceedsIntradayAvg && exceedsLast2Avg) score += 15;
    else if (exceedsIntradayAvg || exceedsLast2Avg) score += 8;

    // 5️⃣ Candle Consistency (10 pts)
    const greenCandles = completedCandles.slice(-3).filter((c) => c.close > c.open).length;
    if (greenCandles >= 3) score += 10;
    else if (greenCandles === 2) score += 7;
    else if (greenCandles === 1) score += 4;

    return Math.min(score, 100);
  };

  // 🔹 Helper: strength label
  const getSignalStrength = (score) => {
    if (score >= 80) return "Strong";
    if (score >= 55) return "Medium";
    return "Weak";
  };

  // Check if market is open (9:30 AM - 3:30 PM PKT)
  useEffect(() => {
    const checkMarketHours = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentMinutes = hours * 60 + minutes;
      const marketOpen = 9 * 60 + 30;
      const marketClose = 15 * 60 + 30;

      setIsMarketOpen(
        currentMinutes >= marketOpen && currentMinutes < marketClose
      );
      setCurrentTime(now);
    };

    checkMarketHours();
    const interval = setInterval(checkMarketHours, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch stock list from API and setup WebSocket
  useEffect(() => {
    const fetchStockList = async () => {
      try {
        // TODO: Replace with your actual API endpoint
        const response = await fetch(
          "https://ielapis.u2ventures.io/api/psxApi/search/all-stocks/"
        );
        const stockList = await response.json();

        // Assuming API returns array of symbols or objects with symbol property
        const symbols = Array.isArray(stockList.stocks)
          ? stockList?.stocks?.map((item) =>
              typeof item === "string" ? item : item.symbol
            )
          : [];

        setTrackedSymbols(symbols);
        return symbols;
      } catch (error) {
        console.error("Error fetching stock list:", error);
        // Fallback to a small list for testing
        const fallbackSymbols = ["PSO", "OGDC", "PPL", "HBL", "MCB"];
        setTrackedSymbols(fallbackSymbols);
        return fallbackSymbols;
      }
    };

    const connectWebSocket = async () => {
      const symbols = await fetchStockList();

      wsRef.current = new WebSocket(
        "wss://ielapis.u2ventures.io/ws/market/feed/"
      );

      wsRef.current.onopen = () => {
        console.log("WebSocket connected");
        // Subscribe to all tracked symbols
        symbols.forEach((symbol) => {
          wsRef.current.send(JSON.stringify({ symbol }));
        });
      };

      wsRef.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.message === "Received tick" && msg.data?.type === "tick") {
            const tick = msg.data.data;
            const symbol = tick.s;
            if (!symbols.includes(symbol)) return;

            processTick(tick);
          }
        } catch (e) {
          console.error("Error parsing WebSocket message:", e);
        }
      };

      wsRef.current.onclose = () => {
        console.log("WebSocket disconnected");
      };

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Process individual tick and build 1-minute candles
  const processTick = (tick) => {
    const symbol = tick.s;
    const price = tick.c;
    const volume = tick.v;
    const timestamp = new Date(tick.t * 1000);
    const ldcp = tick.ldcp || tick.pc || price;
    const priceChange = tick.pch * 100;

    const oneMinBlock = Math.floor(timestamp.getTime() / (1 * 60 * 1000));

    let history = candleHistory.current[symbol];
    if (!history) {
      history = {
        currentBlock: oneMinBlock,
        currentCandle: {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          startVol: volume,
        },
        completedCandles: [],
        ldcp: ldcp,
      };
      candleHistory.current[symbol] = history;
    }

    // Check if we moved to a new 1-minute block
    if (oneMinBlock !== history.currentBlock) {
      // Finalize previous candle
      if (history.currentCandle.volume > 0) {
        history.completedCandles.push({
          ...history.currentCandle,
          block: history.currentBlock,
        });
        // Keep last 30 candles
        if (history.completedCandles.length > 30) {
          history.completedCandles.shift();
        }
      }

      // Start new candle
      history.currentBlock = oneMinBlock;
      history.currentCandle = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        startVol: volume,
      };
    }

    // Update current candle
    history.currentCandle.high = Math.max(history.currentCandle.high, price);
    history.currentCandle.low = Math.min(history.currentCandle.low, price);
    history.currentCandle.close = price;
    history.currentCandle.volume = volume - history.currentCandle.startVol;

    // Update live stock display
    const stock = {
      symbol,
      price: price.toFixed(2),
      volume: volume,
      change: priceChange.toFixed(2),
      timestamp: timestamp,
      ldcp: ldcp,
    };

    setStocks((prev) => {
      const index = prev.findIndex((s) => s.symbol === symbol);
      if (index > -1) {
        const newStocks = [...prev];
        newStocks[index] = stock;
        return newStocks;
      } else {
        return [...prev, stock];
      }
    });

    // Check for surge conditions
    checkSurgeConditions(symbol, history, stock);
  };

  // Check if stock meets surge conditions
  const checkSurgeConditions = (symbol, history, stock) => {
    const currentCandle = history.currentCandle;
    const completedCandles = history.completedCandles;

    // Need at least 2 completed candles to compare
    if (completedCandles.length < 2) return;

    const previousCandle = completedCandles[completedCandles.length - 1];
    const currentPrice = currentCandle.close;
    const currentVolume = currentCandle.volume;

    // Compute averages and exceeds
    const intradayAvgVolume =
      completedCandles.reduce((sum, c) => sum + c.volume, 0) /
      completedCandles.length;

    const last2Candles = completedCandles.slice(-2);
    const last2AvgVolume =
      last2Candles.length > 0
        ? last2Candles.reduce((sum, c) => sum + c.volume, 0) /
          last2Candles.length
        : 0;

    const exceedsIntradayAvg =
      intradayAvgVolume > 0 &&
      currentVolume > intradayAvgVolume * surgeThreshold;
    const exceedsLast2Avg =
      last2AvgVolume > 0 && currentVolume > last2AvgVolume * surgeThreshold;

    const gainFromPrevCandle =
      ((currentPrice - previousCandle.close) / previousCandle.close) * 100;

    // Compute day range from candles
    const dayHigh = Math.max(...completedCandles.map((c) => c.high), currentCandle.high);
    const dayLow = Math.min(...completedCandles.map((c) => c.low), currentCandle.low);
    const gainFromDayLow =
      ((currentPrice - dayLow) / dayLow) * 100;

    // Check if stock is currently in active surge list
    const existingAlert = surgeStocks.find((s) => s.symbol === symbol);

    // EXIT CONDITION: If stock was in surge but price broke below previous candle
    if (existingAlert && currentPrice <= previousCandle.close) {
      moveToExited(existingAlert);
      return;
    }

    // If already in surge and still above previous candle, update it
    if (existingAlert && currentPrice > previousCandle.close) {
      const score = calculateSignalScore({
        currentVolume,
        intradayAvgVolume,
        last2AvgVolume,
        gainFromPrevCandle,
        gainFromDayLow,
        exceedsIntradayAvg,
        exceedsLast2Avg,
        completedCandles,
        currentCandle,
      });
      const signalStrength = getSignalStrength(score);

      setSurgeStocks((prev) =>
        prev.map((s) => {
          if (s.symbol === symbol) {
            return {
              ...s,
              ...stock,
              currentVolume,
              gainFromPrevCandle: gainFromPrevCandle.toFixed(2),
              gainFromDayLow: gainFromDayLow.toFixed(2),
              prevCandleClose: previousCandle.close.toFixed(2),
              signalScore: score,
              signalStrength,
            };
          }
          return s;
        })
      );
      return;
    }

    // NEW ENTRY CONDITIONS (only for stocks not currently in surge)
    // Filter 1: Current price must be > previous candle close (uptrend)
    if (currentPrice <= previousCandle.close) {
      return;
    }

    // Filter 2: Volume must meet minimum threshold
    if (currentVolume < minVolume) {
      return;
    }

    // Filter 3: Volume surge detection (require both)
    if (!exceedsIntradayAvg || !exceedsLast2Avg) {
      return;
    }

    // Filter 4: Minimum gains
    if (gainFromPrevCandle <= 0.5 || gainFromDayLow <= 1) {
      return;
    }

    // Calculate score
    const score = calculateSignalScore({
      currentVolume,
      intradayAvgVolume,
      last2AvgVolume,
      gainFromPrevCandle,
      gainFromDayLow,
      exceedsIntradayAvg,
      exceedsLast2Avg,
      completedCandles,
      currentCandle,
    });
    const signalStrength = getSignalStrength(score);

    // All conditions met - add to surge list as NEW alert (ensure only one per symbol)
    const surgeData = {
      ...stock,
      alertId: `${symbol}-${Date.now()}`, // Unique ID for each alert instance
      entryPrice: currentPrice,
      entryTime: new Date(),
      currentVolume,
      intradayAvgVolume,
      last2AvgVolume,
      exceedsIntradayAvg,
      exceedsLast2Avg,
      gainFromPrevCandle: gainFromPrevCandle.toFixed(2),
      gainFromDayLow: gainFromDayLow.toFixed(2),
      prevCandleClose: previousCandle.close.toFixed(2),
      surgeTime: new Date(),
      signalScore: score,
      signalStrength,
    };

    setSurgeStocks((prev) => {
      // Remove any existing alert for this symbol to ensure only one
      const filtered = prev.filter((s) => s.symbol !== symbol);
      return [...filtered, surgeData].slice(-20);
    });
  };

  const moveToExited = (alert) => {
    setSurgeStocks((prev) => prev.filter((s) => s.alertId !== alert.alertId));
    setExitedStocks((prev) => [...prev, { ...alert, exitTime: new Date() }]);
  };

  const dismissExited = (alertId) => {
    setExitedStocks((prev) => prev.filter((s) => s.alertId !== alertId));
  };

  const formatVolume = (vol) => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
    return vol?.toString();
  };

  // Sort surge stocks by signalScore descending (highest on top)
  const sortedSurgeStocks = [...surgeStocks].sort(
    (a, b) => b.signalScore - a.signalScore
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 mb-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-8 h-8 text-emerald-400" />
              <div>
                <h1 className="text-3xl font-bold text-white">
                  PSX Volume Surge Tracker
                </h1>
                <p className="text-slate-400 mt-1">
                  1-Minute Candles • Trend Detection
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              >
                <Settings className="w-6 h-6 text-slate-300" />
              </button>
              <div className="text-right">
                <div className="flex items-center gap-2 justify-end mb-1">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      isMarketOpen
                        ? "bg-emerald-400 animate-pulse"
                        : "bg-red-400"
                    }`}
                  ></div>
                  <span className="text-slate-300 font-medium">
                    {isMarketOpen ? "Market Open" : "Market Closed"}
                  </span>
                </div>
                <p className="text-slate-400 text-sm">
                  {currentTime.toLocaleTimeString("en-PK", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 mb-6 border border-slate-700">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Alert Settings
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <label className="block text-slate-300 mb-2 font-medium">
                  Minimum Volume Threshold (per 1-min candle)
                </label>
                <input
                  type="number"
                  value={minVolume}
                  onChange={(e) => setMinVolume(Number(e.target.value))}
                  className="w-full bg-slate-700 text-white px-4 py-2 rounded-lg border border-slate-600 focus:border-emerald-400 focus:outline-none"
                  placeholder="e.g., 50000"
                />
                <p className="text-slate-400 text-sm mt-1">
                  Current: {formatVolume(minVolume)}
                </p>
              </div>
              <div>
                <label className="block text-slate-300 mb-2 font-medium">
                  Surge Threshold Multiplier
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={surgeThreshold}
                  onChange={(e) => setSurgeThreshold(Number(e.target.value))}
                  className="w-full bg-slate-700 text-white px-4 py-2 rounded-lg border border-slate-600 focus:border-emerald-400 focus:outline-none"
                  placeholder="e.g., 1.2"
                />
                <p className="text-slate-400 text-sm mt-1">
                  Candle volume must be{" "}
                  {((surgeThreshold - 1) * 100).toFixed(0)}% higher than average
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Volume Surge Alerts */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 mb-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-white">
              Active Volume Surge Alerts
            </h2>
            <span className="ml-auto bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full text-sm font-medium">
              {sortedSurgeStocks.length} Active
            </span>
          </div>

          {sortedSurgeStocks.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No active volume surges</p>
              <p className="text-sm mt-1">
                Stocks with volume surge + uptrend will appear here
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {sortedSurgeStocks.map((stock) => {
                const volRatio = stock.currentVolume / (stock.intradayAvgVolume || 1);
                const strengthClass =
                  stock.signalStrength === "Strong"
                    ? "bg-emerald-600/30 text-emerald-300"
                    : stock.signalStrength === "Medium"
                    ? "bg-amber-600/30 text-amber-300"
                    : "bg-rose-600/30 text-rose-300";
                const scoreClass =
                  stock.signalStrength === "Strong"
                    ? "text-emerald-400"
                    : stock.signalStrength === "Medium"
                    ? "text-amber-400"
                    : "text-red-400";
                return (
                  <div
                    key={stock.alertId}
                    className="bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-lg p-4 hover:border-emerald-500/50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="bg-emerald-500/20 p-3 rounded-lg">
                          <TrendingUp className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white">
                            {stock.symbol}
                          </h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className={`text-sm font-semibold px-2 py-1 rounded ${strengthClass}`}>
                              {stock.signalStrength}
                            </span>
                            <p className="text-slate-400 text-sm">
                              Score: <span className={`font-semibold ${scoreClass}`}>{stock.signalScore}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-white">
                          Rs {stock.price}
                        </div>
                        <div
                          className={`text-sm font-medium ${
                            parseFloat(stock.change) >= 0
                              ? "text-emerald-400"
                              : "text-amber-400"
                          }`}
                        >
                          {parseFloat(stock.change) >= 0 ? "+" : ""}
                          {stock.change}%
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-emerald-500/20">
                      <div>
                        <p className="text-slate-400 text-xs mb-1">Current Vol</p>
                        <p className="text-white font-semibold">
                          {formatVolume(stock.currentVolume)}{" "}
                          <span className="text-emerald-400">
                            ({volRatio.toFixed(1)}×)
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-1">
                          Gain from Prev
                        </p>
                        <p className="text-emerald-400 font-semibold">
                          +{stock.gainFromPrevCandle}%
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-1">
                          From Day Low
                        </p>
                        <p className="text-emerald-400 font-semibold">
                          +{stock.gainFromDayLow}%
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-1">Entry</p>
                        <p className="text-white font-semibold">
                          Rs {stock.entryPrice?.toFixed(2)}
                          <span className="block text-xs text-slate-400 mt-0.5">
                            {new Date(stock.entryTime).toLocaleTimeString("en-PK", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Exited Alerts */}
        {exitedStocks.length > 0 && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 mb-6 border border-slate-700">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="w-6 h-6 text-slate-400" />
              <h2 className="text-xl font-bold text-white">Exited Alerts</h2>
              <span className="ml-auto bg-slate-500/20 text-slate-300 px-3 py-1 rounded-full text-sm font-medium">
                {exitedStocks.length} Exited
              </span>
            </div>

            <div className="grid gap-3">
              {exitedStocks.map((stock) => (
                <div
                  key={stock.alertId}
                  className="bg-slate-700/30 border border-slate-600 rounded-lg p-4 opacity-60"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="bg-slate-600/50 p-3 rounded-lg">
                        <TrendingUp className="w-6 h-6 text-slate-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-bold text-slate-300">
                            {stock.symbol}
                          </h3>
                          <span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs font-semibold">
                            EXITED
                          </span>
                        </div>
                        <p className="text-slate-500 text-sm">
                          Price broke below previous candle
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xl font-bold text-slate-300">
                          Rs {stock.price}
                        </div>
                        <div className="text-sm text-slate-400">
                          Exit:{" "}
                          {new Date(stock.exitTime).toLocaleTimeString(
                            "en-PK",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => dismissExited(stock.alertId)}
                        className="bg-slate-600 hover:bg-slate-500 text-slate-300 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-600">
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Entry Time</p>
                      <p className="text-slate-300 font-semibold">
                        {new Date(stock.entryTime).toLocaleTimeString("en-PK", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Entry Price</p>
                      <p className="text-slate-300 font-semibold">
                        Rs {stock.entryPrice.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Exit Price</p>
                      <p className="text-slate-300 font-semibold">
                        Rs {stock.price}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500 text-xs mb-1">Duration</p>
                      <p className="text-slate-300 font-semibold">
                        {Math.floor(
                          (new Date(stock.exitTime) -
                            new Date(stock.entryTime)) /
                            60000
                        )}
                        m
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* All Stocks Grid */}
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-4">
          Live Stock Feed ({stocks.length} stocks)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {stocks.map((stock, idx) => (
            <div
              key={`${stock.symbol}-${idx}`}
              className="bg-slate-700/30 rounded-lg p-4 border border-slate-600 hover:border-slate-500 transition-all"
            >
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-bold text-white">{stock.symbol}</h3>
                <span
                  className={`text-sm font-medium px-2 py-1 rounded ${
                    parseFloat(stock.change) >= 0
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {parseFloat(stock.change) >= 0 ? "+" : ""}
                  {stock.change}%
                </span>
              </div>
              <div className="text-2xl font-bold text-white mb-2">
                Rs {stock.price}
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Session Volume</span>
                <span
                  className={`font-semibold ${
                    stock.volume > 100000
                      ? "text-emerald-400"
                      : "text-slate-300"
                  }`}
                >
                  {formatVolume(stock.volume)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <p className="text-blue-300 text-sm mb-2">
          <strong>Enhanced Detection System:</strong>
        </p>
        <ul className="text-blue-300 text-sm space-y-1 ml-4 list-disc">
          <li>
            <strong>1-minute candles</strong> built from tick data for faster
            detection
          </li>
          <li>
            <strong>Entry:</strong> Volume surge + Current price &gt; previous
            candle close
          </li>
          <li>
            <strong>Sticky alerts:</strong> Once triggered, stays active until
            exit condition
          </li>
          <li>
            <strong>Exit:</strong> Alert grays out when price drops below
            previous candle close
          </li>
          <li>
            <strong>Re-entry:</strong> Dismissed stocks can trigger new alerts
            if conditions met again
          </li>
          <li>
            <strong>Dynamic stock list:</strong> Fetched from API on startup
            (update YOUR_API_ENDPOINT_HERE)
          </li>
        </ul>
      </div>
    </div>
  );
};

export default PSXVolumeTracker;