import ccxt from 'ccxt';
import * as dotenv from 'dotenv';
import express from 'express';
import https from 'https';

import { CONFIG } from './src/config';
import { evaluateStrategy, calculateDynamicAmount } from './src/strategy';
import { createInitialPositionState, processActivePosition } from './src/tradeManager';
import { logAIDecision } from './src/utils/logger';
import { PositionState } from './src/types';

dotenv.config();

// Diagnostics
console.log("===[ ENV DIAGNOSTICS ]===");
console.log("API Key loaded:", process.env.WEEX_API_KEY ? "YES (Length: " + process.env.WEEX_API_KEY.length + ")" : "NO/UNDEFINED");
console.log("Secret loaded:", process.env.WEEX_SECRET_KEY ? "YES" : "NO/UNDEFINED");
console.log("Passphrase loaded:", process.env.WEEX_PASSPHRASE ? "YES" : "NO/UNDEFINED");
console.log("=========================");

// Express App Setup
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send({ status: "online", engine: "WEEX Dual AI Engine Active" });
});

app.listen(PORT, () => {
  console.log(`[Web Server] Operational on port ${PORT}`);
});

// Self-Pinger
function startSelfPinger() {
  setInterval(() => {
    if (CONFIG.RENDER_URL.includes('your-app-name')) return;
    console.log(`[Pinger] Firing self-ping...`);
    https.get(CONFIG.RENDER_URL, (res) => {
      console.log(`[Pinger] Response status: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error(`[Pinger] Ping failed:`, err.message);
    });
  }, 600000);
}

/**
 * HELPER: Exchange Position Syncing filtered specifically to an Engine's Asset Pool
 */
async function syncOpenExchangePosition(exchange: any, assetPool: string[]): Promise<PositionState | null> {
  try {
    const positions = await exchange.fetchPositions();
    if (!positions || !Array.isArray(positions)) return null;

    const active = positions.find((p: any) => {
      const size = parseFloat(p.contracts || p.size || p.amount || 0);
      return size > 0 && assetPool.includes(p.symbol);
    });

    if (active) {
      const symbol = active.symbol;
      const entryPrice = parseFloat(active.entryPrice || active.price || 0);
      const units = parseFloat(active.contracts || active.size || active.amount || 0);

      if (entryPrice > 0 && units > 0) {
        console.log(`\n🔍 [EXCHANGE SYNC] Found active live trade: ${units} units of ${symbol} @ $${entryPrice}`);
        return {
          isHoldingPosition: true,
          activeAsset: symbol,
          entryPrice: entryPrice,
          takeProfitPrice: entryPrice * 1.0200, // Re-establish TP (+2.00%)
          stopLossPrice: entryPrice * 0.9900,   // Re-establish SL (-1.00%)
          tradeAmountUnits: units,
          entryTime: Date.now()
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Sync Check Warning] Could not sync positions: ${err.message}`);
  }
  return null;
}

/**
 * CORE REUSABLE TRADING ENGINE
 */
async function runTradingEngine(
  engineName: string,
  exchange: any,
  assetPool: string[],
  marginAllocationRatio: number
) {
  let currentAssetIndex = 0;
  let closePrices: number[] = [];
  let assetStartTime = Date.now();
  const THREE_HOURS_MS = 24 * 60 * 60 * 1000;

  let position = createInitialPositionState();

  console.log(`🚀 [${engineName}] Engine Initialized. Assets: ${assetPool.join(', ')}`);

  while (true) {
    try {
      // --- STEP 1: RE-SYNC EXCHANGE POSITIONS IF LOCAL STATE IS EMPTY ---
      if (!position.isHoldingPosition && !CONFIG.DRY_RUN) {
        const syncedPosition = await syncOpenExchangePosition(exchange, assetPool);
        if (syncedPosition) {
          position = syncedPosition;
          
          const matchingIndex = assetPool.findIndex(a => a === position.activeAsset);
          if (matchingIndex !== -1) {
            currentAssetIndex = matchingIndex;
          }
        }
      }

      const activeAsset = position.isHoldingPosition ? position.activeAsset : assetPool[currentAssetIndex];
      const elapsed = Date.now() - assetStartTime;

      // --- STEP 2: PIVOT CONTROL ---
      if (elapsed >= THREE_HOURS_MS && !position.isHoldingPosition) {
        console.log(`\n🔄 [${engineName} Pivot] 3-Hour Window elapsed! Switching asset focus...`);
        currentAssetIndex = (currentAssetIndex + 1) % assetPool.length;
        closePrices = [];
        assetStartTime = Date.now();
        continue;
      } else if (elapsed >= THREE_HOURS_MS && position.isHoldingPosition) {
        console.log(`⚠️ [${engineName} Pivot Postponed] Holding active trade on ${activeAsset}.`);
      }

      // --- STEP 3: TICKER FETCH ---
      const ticker = await exchange.fetchTicker(activeAsset);
      const currentPrice = ticker.last as number;
      closePrices.push(currentPrice);
      if (closePrices.length > 50) closePrices.shift();

      // --- MODE A: MONITORING ACTIVE POSITION ---
      if (position.isHoldingPosition) {
        const wasHoldingBefore = position.isHoldingPosition;
        position = await processActivePosition(exchange, position, currentPrice);

        const isHardStop = position.lastExitReason === "HARD_STOP_LOSS_HIT";
        const isStagnant = position.lastExitReason === "24H_STAGNANT_TIMEOUT";

        if (wasHoldingBefore && !position.isHoldingPosition && (isHardStop || isStagnant)) {
          const reasonText = isHardStop ? "crashed into Hard Stop Loss (-1.00%)" : "stagnated for 24 hours";
          console.log(`\n🛑 [${engineName} IMMEDIATE PIVOT] Asset ${activeAsset} ${reasonText}. Abandoning & pivoting!`);
          
          currentAssetIndex = (currentAssetIndex + 1) % assetPool.length;
          closePrices = [];
          assetStartTime = Date.now();
          continue;
        }
      } 
      // --- MODE B: HUNTING FOR STRATEGY CROSSOVER ---
      else {
        const minsRemaining = Math.max(0, ((THREE_HOURS_MS - elapsed) / 60000)).toFixed(1);
        console.log(`[${engineName} Hunting: ${activeAsset}] Price: ${currentPrice} | Window: ${closePrices.length}/50 | Next shift: ${minsRemaining} mins`);

        const signal = evaluateStrategy(closePrices, activeAsset);

        if (signal.isSignal) {
          const entryPrice = currentPrice;

          const balanceStructure = await exchange.fetchBalance({ 'type': 'swap' });
          const fetchedBalance = (balanceStructure.free as any)['USDT'] || 0;
          const availableUSDT = fetchedBalance > 0 ? fetchedBalance : (CONFIG.DRY_RUN ? 20000 : 0);

          const dynamicMargin = availableUSDT * marginAllocationRatio;
          if (dynamicMargin < 1) {
            console.log(`⚠️ [${engineName}] Balance check: Dynamic margin ($${dynamicMargin.toFixed(2)}) below safety limit ($1.00). Skipping.`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
            continue;
          }

       // Calculate raw trade amount based on dynamic margin
let tradeAmount = calculateDynamicAmount(exchange, activeAsset, currentPrice, dynamicMargin, CONFIG.LEVERAGE_LIMIT);
if (tradeAmount === 0) continue;

// 1. Resolve asset-specific registry rules from CONFIG (fallback to DEFAULT if not defined)
const rules = CONFIG.ASSET_RULES || {};
const ruleKey = Object.keys(rules).find(key => activeAsset.includes(key)) || 'DEFAULT';
const assetRule = rules[ruleKey] || { minLot: 0.001, integerOnly: false };

// 2. Safely query CCXT market limits with fallback to your config registry floor
const market = exchange.market(activeAsset);
const ccxtMin = market?.limits?.amount?.min || 0;
const effectiveMinAmount = ccxtMin > 0 ? ccxtMin : assetRule.minLot;

// 3. Format integer-only assets (e.g. 1000PEPE, PONS)
if (assetRule.integerOnly) {
  tradeAmount = Math.floor(tradeAmount);
}

// 4. Validate final order quantity against effective minimum threshold
if (tradeAmount < effectiveMinAmount) {
  console.log(` [${engineName}] Skipping ${activeAsset}: Size (${tradeAmount}) is below required minimum threshold (${effectiveMinAmount}).`);
  await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
  continue;
}

let liveOrderId: string | undefined = "SIMULATED_ID";

if (!CONFIG.DRY_RUN) {
  try {
    const order = await exchange.createMarketBuyOrder(activeAsset, tradeAmount);
    liveOrderId = order.id;
  } catch (tradeError: any) {
    console.error(`❌ [${engineName} REJECTION] Order failed:`, tradeError.message);
    continue;
  }
}

          position = {
            isHoldingPosition: true,
            activeAsset,
            entryPrice,
            takeProfitPrice: entryPrice * 1.0200,
            stopLossPrice: entryPrice * 0.9900,
            tradeAmountUnits: tradeAmount,
            entryTime: Date.now()
          };

          logAIDecision('EMA_CROSSOVER_BUY', signal.reason, {
            mode: CONFIG.DRY_RUN ? "DRY_RUN" : "LIVE",
            engine: engineName,
            orderId: liveOrderId,
            asset: activeAsset,
            executionPrice: entryPrice,
            amountUnits: tradeAmount
          });
        }
      }
    } catch (networkError: any) {
      console.warn(`[${engineName} Network Warning] ${networkError.message}`);
    }

    await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
  }
}

// Master Launcher
async function startTradingEngine() {
  const exchange = new ccxt.weex({
    'apiKey': process.env.WEEX_API_KEY,
    'secret': process.env.WEEX_SECRET_KEY,
    'password': process.env.WEEX_PASSPHRASE,
    'timeout': 10000,
    'enableRateLimit': true, // Auto-throttles API requests to protect against bans
    'options': { 'defaultType': 'swap' }
  });

  try {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║           WEEX DUAL AI ENGINE ACTIVATED              ║");
    console.log("╚══════════════════════════════════════════════════════╝");

    await exchange.loadMarkets();

    const allAssets = [...CONFIG.MAJOR_ASSETS, ...CONFIG.ALT_ASSETS, ...CONFIG.MEME_ASSETS];
    for (const asset of allAssets) {
      try {
    await exchange.setLeverage(CONFIG.LEVERAGE_LIMIT, asset);
    console.log(`✅ Leverage set to ${CONFIG.LEVERAGE_LIMIT}x for ${asset}`);
  } catch (err: any) {
    console.warn(`⚠️ [API Skip] Could not set leverage for ${asset}: ${err.message}`);
  }
    }

    startSelfPinger();

    // Launch both engines concurrently
    await Promise.all([
      runTradingEngine("MAJOR_ENGINE", exchange, CONFIG.MAJOR_ASSETS, 0.20), // 30% margin allocation
      runTradingEngine("ALT_ENGINE", exchange, CONFIG.ALT_ASSETS, 0.25),     // 30% margin allocation
      runTradingEngine("MEME_ENGINE", exchange, CONFIG.MEME_ASSETS, 0.25) // 30%
    ]);

  } catch (criticalError: any) {
    console.error("❌ CRITICAL: Engine initialization failed:", criticalError.message);
    process.exit(1);
  }
}

startTradingEngine();
