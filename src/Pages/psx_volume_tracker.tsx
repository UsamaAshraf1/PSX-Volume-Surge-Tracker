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
  const volumeHistory = useRef({});
  const wsRef = useRef(null);

  const trackedSymbols = [
    "KEL",
    "PTC",
    "BOP",
    "CNERGY",
    "PIBTL",
    "FFL",
    "PAEL",
    "SEARL",
    "PSO",
    "HUBC",
    "TRG",
    "SYS",
    "NBP",
    "SSGC",
    "FCCL",
    "UNITY",
    "PPL",
    "MLCF",
    "OGDC",
    "CPHL",
    "AKBL",
    "HCAR",
    "FABL",
    "BAFL",
    "HUMNL",
    "AIRLINK",
    "SNGP",
    "FFC",
    "YOUW",
    "LUCK",
    "HBL",
    "PSX",
    "MARI",
    "DGKC",
    "LOTCHEM",
    "MCB",
    "NML",
    "KOHC",
    "UBL",
    "ATRL",
    "ABL",
    "ENGROH",
    "GHNI",
    "EFERT",
    "MEBL",
    "APL",
    "BAHL",
    "KAPCO",
    "AICL",
    "FATIMA",
    "ISL",
    "GAL",
    "PIOC",
    "TGL",
    "DHPL",
    "CHCC",
    "PSEL",
    "POL",
    "AGP",
    "ILP",
    "NATF",
    "DCR",
    "JVDC",
    "GHGL",
    "SCBPL",
    "SAZEW",
    "HALEON",
    "HINOON",
    "INIL",
    "HGFA",
    "GLAXO",
    "KTML",
    "PABC",
    "MTL",
    "HMB",
    "LCI",
    "INDU",
    "SSOM",
    "SHFA",
    "PGLC",
    "FHAM",
    "PKGS",
    "BNWM",
    "PAKT",
    "GADT",
    "BWCL",
    "MUREB",
    "COLG",
    "ABOT",
    "PKGP",
    "THALL",
    "TPLRF1",
    "ATLH",
    "MEHT",
    "SRVI",
    "JDWS",
    "NESTLE",
    "UPFL",
    "RMPL",
    "IBFL",
  ];
  // Check if market is open (9:30 AM - 3:30 PM PKT)
  useEffect(() => {
    const checkMarketHours = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentMinutes = hours * 60 + minutes;
      const marketOpen = 9 * 60 + 30; // 9:30 AM
      const marketClose = 15 * 60 + 30; // 3:30 PM

      setIsMarketOpen(
        currentMinutes >= marketOpen && currentMinutes < marketClose
      );
      setCurrentTime(now);
    };

    checkMarketHours();
    const interval = setInterval(checkMarketHours, 60000);
    return () => clearInterval(interval);
  }, []);

  // WebSocket connection setup
  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket(
        "wss://ielapis.u2ventures.io/ws/market/feed/"
      );

      wsRef.current.onopen = () => {
        console.log("WebSocket connected");
        // Subscribe to all tracked symbols
        trackedSymbols.forEach((symbol) => {
          wsRef.current.send(JSON.stringify({ symbol }));
        });
      };

      wsRef.current.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.message === "Received tick" && msg.data?.type === "tick") {
            const tick = msg.data.data;
            const symbol = tick.s;
            if (!trackedSymbols.includes(symbol)) return;

            const stock = {
              symbol,
              price: tick.c.toFixed(2),
              volume: tick.v,
              change: (tick.pch * 100).toFixed(2),
              timestamp: new Date(tick.t * 1000),
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

            processVolumeData([stock]);
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

  // Process volume data and check conditions
  const processVolumeData = (stockData) => {
    stockData.forEach((stock) => {
      const symbol = stock.symbol;
      const now = stock.timestamp;
      const fiveMinBlock = Math.floor(now.getTime() / (5 * 60 * 1000));
      const cumVol = stock.volume;

      let history = volumeHistory.current[symbol];
      if (!history) {
        history = {
          lastCum: 0,
          currentBlock: fiveMinBlock,
          currentBlockVol: 0,
          blocks: {},
          intradayBlockVols: [],
        };
        volumeHistory.current[symbol] = history;
      }

      const deltaVol = cumVol - history.lastCum;
      history.lastCum = cumVol;

      let currentBlockVol;
      if (fiveMinBlock !== history.currentBlock) {
        // Finalize previous block
        if (history.currentBlockVol > 0) {
          history.blocks[history.currentBlock] = history.currentBlockVol;
          history.intradayBlockVols.push(history.currentBlockVol);
        }
        // Start new block
        history.currentBlock = fiveMinBlock;
        history.currentBlockVol = deltaVol;
        currentBlockVol = deltaVol;
      } else {
        history.currentBlockVol += deltaVol;
        currentBlockVol = history.currentBlockVol;
      }

      // Calculate intraday average volume (average of completed block volumes)
      const intradayAvg =
        history.intradayBlockVols.length > 0
          ? history.intradayBlockVols.reduce((a, b) => a + b, 0) /
            history.intradayBlockVols.length
          : 0;

      // Get last 2 completed blocks average
      const completedBlocks = Object.keys(history.blocks)
        .map(Number)
        .sort((a, b) => b - a)
        .slice(0, 2);

      let last2BlocksAvg = 0;
      if (completedBlocks.length >= 2) {
        last2BlocksAvg =
          completedBlocks.reduce(
            (sum, block) => sum + (history.blocks[block] || 0),
            0
          ) / 2;
      } else if (completedBlocks.length === 1) {
        last2BlocksAvg = history.blocks[completedBlocks[0]] || 0;
      }

      // Check if current block volume meets conditions
      const meetsVolumeThreshold = currentBlockVol >= minVolume;
      const exceedsIntradayAvg =
        intradayAvg > 0 && currentBlockVol > intradayAvg * surgeThreshold;
      const exceedsLast2Blocks =
        last2BlocksAvg > 0 && currentBlockVol > last2BlocksAvg * surgeThreshold;

      const isSurge =
        meetsVolumeThreshold && (exceedsIntradayAvg || exceedsLast2Blocks);

      setSurgeStocks((prev) => {
        const existingIndex = prev.findIndex((s) => s.symbol === stock.symbol);
        const surgeData = {
          ...stock,
          currentBlockVol,
          intradayAvg,
          last2BlocksAvg,
          exceedsIntradayAvg,
          exceedsLast2Blocks,
          surgeTime: new Date(),
        };

        if (isSurge) {
          if (existingIndex > -1) {
            const newSurges = [...prev];
            newSurges[existingIndex] = surgeData;
            return newSurges;
          } else {
            return [...prev, surgeData].slice(-20);
          }
        } else {
          // Remove if no longer surging
          if (existingIndex > -1) {
            return prev.filter((s) => s.symbol !== stock.symbol);
          }
          return prev;
        }
      });
    });
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
                  KSE-100 Index • 5-Minute Intervals
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
                  Minimum Volume Threshold
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
                  Current volume must be{" "}
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
                Surges based on WebSocket tick data will appear here
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {surgeStocks
                .filter((stock) => parseFloat(stock.change) >= 0)
                .map((stock, idx) => (
                  <div
                    key={`${stock.symbol}-${idx}`}
                    className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-lg p-4 hover:border-amber-500/50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="bg-amber-500/20 p-3 rounded-lg">
                          <TrendingUp className="w-6 h-6 text-amber-400" />
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
                              stock.exceedsLast2Blocks && (
                                <span className="mx-1">•</span>
                              )}
                            {stock.exceedsLast2Blocks && (
                              <span className="text-emerald-400">
                                ✓ Last 2 Blocks
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
                              : "text-red-400"
                          }`}
                        >
                          {parseFloat(stock.change) >= 0 ? "+" : ""}
                          {stock.change}%
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-amber-500/20">
                      <div>
                        <p className="text-slate-400 text-xs mb-1">
                          Current Block Vol
                        </p>
                        <p className="text-white font-semibold">
                          {formatVolume(stock.currentBlockVol)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-1">
                          Intraday Avg
                        </p>
                        <p className="text-white font-semibold">
                          {formatVolume(stock.intradayAvg)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-1">
                          Last 2 Blocks
                        </p>
                        <p className="text-white font-semibold">
                          {formatVolume(stock.last2BlocksAvg)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 text-xs mb-1">
                          Detected At
                        </p>
                        <p className="text-white font-semibold">
                          {new Date(stock.surgeTime).toLocaleTimeString(
                            "en-PK",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
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
          <h2 className="text-xl font-bold text-white mb-4">Live Stock Feed</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          <p className="text-blue-300 text-sm">
            <strong>Setup Instructions:</strong> WebSocket connected to PSX feed
            at{" "}
            <code className="bg-slate-700 px-2 py-1 rounded">
              wss://ielapis.u2ventures.io/ws/market/feed/
            </code>
            . Subscribed to tracked KSE-100 symbols on connection. The app
            processes ticks for these symbols and detects surges when 5-minute
            block volume exceeds thresholds.
          </p>
          <ul className="text-blue-300 text-sm mt-2 ml-4 list-disc">
            <li>Volume surges based on cumulative deltas in 5-minute blocks</li>
            <li>Minimum block volume threshold (default: 50K, adjustable)</li>
            <li>
              Current block volume exceeds intraday block average OR last 2
              blocks average by multiplier
            </li>
            <li>Thresholds dynamically adjustable via the settings panel</li>
            <li>Surges are removed when conditions no longer met</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default PSXVolumeTracker;
