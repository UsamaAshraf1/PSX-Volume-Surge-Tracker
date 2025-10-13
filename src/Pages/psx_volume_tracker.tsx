import React, { useState, useEffect, useRef } from "react";
import { TrendingUp, Activity, AlertCircle, Settings } from "lucide-react";

const PSXVolumeTracker = () => {
  const [stocks, setStocks] = useState([]);
  const [surgeStocks, setSurgeStocks] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isMarketOpen, setIsMarketOpen] = useState(false);
  const [minVolume, setMinVolume] = useState(50000);
  const [surgeThreshold, setSurgeThreshold] = useState(1.2);
  const [showSettings, setShowSettings] = useState(false);
  const [trackedSymbols, setTrackedSymbols] = useState([]);
  const candleHistory = useRef({});
  const wsRef = useRef(null);

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

        console.log(stockList);
        console.log(symbols);
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
    const ldcp = tick.ldcp || tick.pc || price; // Last day close price
    const dayLow = tick.l || price;
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
        dayLow: dayLow,
      };
      candleHistory.current[symbol] = history;
    }

    // Update day low
    history.dayLow = Math.min(history.dayLow, dayLow);

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
      dayLow: history.dayLow,
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

    // Need at least 1 completed candle to compare
    if (completedCandles.length === 0) return;

    const currentPrice = currentCandle.close;
    const currentVolume = currentCandle.volume;
    const previousCandle = completedCandles[completedCandles.length - 1];

    // Filter 1: Current price must be > previous candle close (uptrend)
    if (currentPrice <= previousCandle.close) {
      removeSurgeStock(symbol);
      return;
    }

    // Filter 2: Volume must meet minimum threshold
    if (currentVolume < minVolume) {
      removeSurgeStock(symbol);
      return;
    }

    // Calculate average volume from completed candles
    const intradayAvgVolume =
      completedCandles.length > 0
        ? completedCandles.reduce((sum, c) => sum + c.volume, 0) /
          completedCandles.length
        : 0;

    // Calculate last 2 candles average volume
    const last2Candles = completedCandles.slice(-2);
    const last2AvgVolume =
      last2Candles.length > 0
        ? last2Candles.reduce((sum, c) => sum + c.volume, 0) /
          last2Candles.length
        : 0;

    // Filter 4: Volume surge detection
    const exceedsIntradayAvg =
      intradayAvgVolume > 0 &&
      currentVolume > intradayAvgVolume * surgeThreshold;
    const exceedsLast2Avg =
      last2AvgVolume > 0 && currentVolume > last2AvgVolume * surgeThreshold;

    const hasVolumeSurge = exceedsIntradayAvg || exceedsLast2Avg;

    if (!hasVolumeSurge) {
      removeSurgeStock(symbol);
      return;
    }

    // Calculate % gain from previous candle
    const gainFromPrevCandle =
      ((currentPrice - previousCandle.close) / previousCandle.close) * 100;

    // Calculate % from day low
    const gainFromDayLow =
      ((currentPrice - history.dayLow) / history.dayLow) * 100;

    // All conditions met - add to surge list
    const surgeData = {
      ...stock,
      currentVolume,
      intradayAvgVolume,
      last2AvgVolume,
      exceedsIntradayAvg,
      exceedsLast2Avg,
      gainFromPrevCandle: gainFromPrevCandle.toFixed(2),
      gainFromDayLow: gainFromDayLow.toFixed(2),
      prevCandleClose: previousCandle.close.toFixed(2),
      surgeTime: new Date(),
    };

    setSurgeStocks((prev) => {
      const existingIndex = prev.findIndex((s) => s.symbol === symbol);
      if (existingIndex > -1) {
        const newSurges = [...prev];
        newSurges[existingIndex] = surgeData;
        return newSurges;
      } else {
        return [...prev, surgeData].slice(-20);
      }
    });
  };

  const removeSurgeStock = (symbol) => {
    setSurgeStocks((prev) => prev.filter((s) => s.symbol !== symbol));
  };

  const formatVolume = (vol) => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
    return vol?.toString();
  };

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
                  onChange={(e: { target: { value: any } }) =>
                    setMinVolume(Number(e.target.value))
                  }
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
              Volume Surge Alerts
            </h2>
            <span className="ml-auto bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full text-sm font-medium">
              {surgeStocks.length} Active
            </span>
          </div>

          {surgeStocks.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No volume surges detected yet</p>
              <p className="text-sm mt-1">
                Stocks with volume surge + uptrend will appear here
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {surgeStocks.map((stock, idx) => (
                <div
                  key={`${stock.symbol}-${idx}`}
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
                        <p className="text-slate-400 text-sm">
                          {stock.exceedsIntradayAvg && (
                            <span className="text-emerald-400">
                              ✓ Intraday Avg
                            </span>
                          )}
                          {stock.exceedsIntradayAvg &&
                            stock.exceedsLast2Avg && (
                              <span className="mx-1">•</span>
                            )}
                          {stock.exceedsLast2Avg && (
                            <span className="text-emerald-400">
                              ✓ Last 2 Candles
                            </span>
                          )}
                        </p>
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
                  <div className="grid grid-cols-5 gap-3 mt-4 pt-4 border-t border-emerald-500/20">
                    <div>
                      <p className="text-slate-400 text-xs mb-1">Current Vol</p>
                      <p className="text-white font-semibold">
                        {formatVolume(stock.currentVolume)}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs mb-1">
                        Intraday Avg
                      </p>
                      <p className="text-white font-semibold">
                        {formatVolume(stock.intradayAvgVolume)}
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
                      <p className="text-slate-400 text-xs mb-1">Detected At</p>
                      <p className="text-white font-semibold">
                        {new Date(stock.surgeTime).toLocaleTimeString("en-PK", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
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
                  <h3 className="text-lg font-bold text-white">
                    {stock.symbol}
                  </h3>
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
              <strong>Volume surge:</strong> Current candle volume exceeds
              intraday OR last 2 candles average
            </li>
            <li>
              <strong>Uptrend filter:</strong> Current price must be greater
              than previous candle close
            </li>
            <li>
              <strong>No LDCP filter:</strong> Catches both breakouts and strong
              recovery plays
            </li>
            <li>
              <strong>Dynamic stock list:</strong> Fetched from API on startup
              (update YOUR_API_ENDPOINT_HERE)
            </li>
            <li>Stocks removed from alerts when conditions no longer met</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default PSXVolumeTracker;
