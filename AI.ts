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
  res.send({ status: "online", engine: "WEEX AI Wars Bot Active" });
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
 * HELPER: Direct Exchange Query to Re-Hydrate Open Positions
 * Protects against memory wipes on Render restarts/re-deploys.
 */
async function syncOpenExchangePosition(exchange: any): Promise<PositionState | null> {
  try {
    const positions = await exchange.fetchPositions();
    if (!positions || !Array.isArray(positions)) return null;

    // Find any position where contract/size is strictly > 0
    const active = positions.find((p: any) => {
      const size = parseFloat(p.contracts || p.size || p.amount || 0);
      return size > 0;
    });

    if (active) {
      const symbol = active.symbol;
      const entryPrice = parseFloat(active.entryPrice || active.price || 0);
      const units = parseFloat(active.contracts || active.size || active.amount || 0);

      if (entryPrice > 0 && units > 0) {
        console.log(`\n🔍 [EXCHANGE SYNC DETECTED] Found active live trade on WEEX: ${units} units of ${symbol} @ $${entryPrice}`);
        return {
          isHoldingPosition: true,
          activeAsset: symbol,
          entryPrice: entryPrice,
          takeProfitPrice: entryPrice * 1.0200, // Re-establish TP (+2.00%)
          stopLossPrice: entryPrice * 0.9900,   // Re-establish SL (-1.00%)
          tradeAmountUnits: units,
          entryTime: Date.now() // Timestamp fallback
        };
      }
    }
  } catch (err: any) {
    console.warn(`[Sync Check Warning] Could not sync positions from WEEX: ${err.message}`);
  }
  return null;
}

// Main Trading Loop
async function startTradingEngine() {
  const exchange = new ccxt.weex({
    'apiKey': process.env.WEEX_API_KEY,
    'secret': process.env.WEEX_SECRET_KEY,
    'password': process.env.WEEX_PASSPHRASE,
    'timeout': 10000,
    'options': { 'defaultType': 'swap' }
  });

  try {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║           WEEX AI WARS ENGINE ACTIVATED              ║");
    console.log("╚══════════════════════════════════════════════════════╝");

    await exchange.loadMarkets();
    for (const asset of CONFIG.ACTIVE_ASSETS) {
      await exchange.setLeverage(CONFIG.LEVERAGE_LIMIT, asset);
    }

    startSelfPinger();

    let currentAssetIndex = 0;
    let closePrices: number[] = [];
    let assetStartTime = Date.now();
    const THREE_HOURS_MS = 1 * 60 * 60 * 1000;

    let position = createInitialPositionState();

    while (true) {
      try {
        // --- STEP 1: RE-SYNC EXCHANGE POSITIONS IF LOCAL STATE IS EMPTY ---
        if (!position.isHoldingPosition && !CONFIG.DRY_RUN) {
          const syncedPosition = await syncOpenExchangePosition(exchange);
          if (syncedPosition) {
            position = syncedPosition;
            
            // Adjust current asset index to match the active position's symbol
            const matchingIndex = CONFIG.ACTIVE_ASSETS.findIndex(a => a === position.activeAsset);
            if (matchingIndex !== -1) {
              currentAssetIndex = matchingIndex;
            }
          }
        }

        const activeAsset = position.isHoldingPosition ? position.activeAsset : CONFIG.ACTIVE_ASSETS[currentAssetIndex];
        const elapsed = Date.now() - assetStartTime;

        // --- STEP 2: PIVOT CONTROL ---
        if (elapsed >= THREE_HOURS_MS && !position.isHoldingPosition) {
          console.log(`\n🔄 [Pivot Alarm] Window elapsed! Switching focus...`);
          currentAssetIndex = (currentAssetIndex + 1) % CONFIG.ACTIVE_ASSETS.length;
          closePrices = [];
          assetStartTime = Date.now();
          continue;
        } else if (elapsed >= THREE_HOURS_MS && position.isHoldingPosition) {
          console.log(`⚠️ [Pivoting Postponed] Holding active trade on ${activeAsset}.`);
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

          // 🚨 HARD STOP LOSS / STAGNANT TIMEOUT PIVOT TRIGGER
          const isHardStop = position.lastExitReason === "HARD_STOP_LOSS_HIT";
          const isStagnant = position.lastExitReason === "24H_STAGNANT_TIMEOUT";

          if (wasHoldingBefore && !position.isHoldingPosition && (isHardStop || isStagnant)) {
            const reasonText = isHardStop ? "crashed into Hard Stop Loss (-1.00%)" : "stagnated for 24 hours";
            console.log(`\n🛑 [IMMEDIATE PIVOT] Asset ${activeAsset} ${reasonText}. Abandoning asset & pivoting immediately!`);
            
            currentAssetIndex = (currentAssetIndex + 1) % CONFIG.ACTIVE_ASSETS.length;
            closePrices = [];
            assetStartTime = Date.now(); // Reset hunt timer for the new asset
            continue;
          }
        } 
        // --- MODE B: HUNTING FOR STRATEGY CROSSOVER ---
        else {
          const minsRemaining = Math.max(0, ((THREE_HOURS_MS - elapsed) / 60000)).toFixed(1);
          console.log(`[Hunting: ${activeAsset}] Price: ${currentPrice} | Window: ${closePrices.length}/50 | Next shift: ${minsRemaining} mins`);

          const signal = evaluateStrategy(closePrices, activeAsset);

          if (signal.isSignal) {
            const entryPrice = currentPrice;
            const takeProfitPrice = entryPrice * 1.0200; // +2.00%
            const stopLossPrice = entryPrice * 0.9900;   // -1.00%

            const balanceStructure = await exchange.fetchBalance({ 'type': 'swap' });
            const fetchedBalance = (balanceStructure.free as any)['USDT'] || 0;
            const availableUSDT = fetchedBalance > 0 ? fetchedBalance : (CONFIG.DRY_RUN ? 20000 : 0);

            const dynamicMargin = availableUSDT * 0.50;
            if (dynamicMargin < 1) {
              console.log(`⚠️ Balance check: Dynamic margin ($${dynamicMargin.toFixed(2)}) is below safety limit ($1.00). Skipping trade.`);
              await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
              continue;
            }

            const tradeAmount = calculateDynamicAmount(exchange, activeAsset, currentPrice, dynamicMargin, CONFIG.LEVERAGE_LIMIT);
            if (tradeAmount === 0) continue;

            let liveOrderId: string | undefined = "SIMULATED_ID";

            if (!CONFIG.DRY_RUN) {
              try {
                const order = await exchange.createMarketBuyOrder(activeAsset, tradeAmount);
                liveOrderId = order.id;
              } catch (tradeError: any) {
                console.error(`❌ [WEEX REJECTION] Order failed:`, tradeError.message);
                continue;
              }
            }

            // Assign matching properties for tradeManager.ts
            position = {
              isHoldingPosition: true,
              activeAsset,
              entryPrice,
              takeProfitPrice,
              stopLossPrice,
              tradeAmountUnits: tradeAmount,
              entryTime: Date.now()
            };

            logAIDecision('EMA_CROSSOVER_BUY', signal.reason, {
              mode: CONFIG.DRY_RUN ? "DRY_RUN" : "LIVE",
              orderId: liveOrderId,
              asset: activeAsset,
              executionPrice: entryPrice,
              amountUnits: tradeAmount
            });
          }
        }
      } catch (networkError: any) {
        console.warn(`[Network Warning] ${networkError.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
    }
  } catch (criticalError: any) {
    console.error("❌ CRITICAL: Engine initialization failed:", criticalError.message);
    process.exit(1);
  }
}

startTradingEngine();
