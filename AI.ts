import ccxt from 'ccxt';
import * as dotenv from 'dotenv';
import express from 'express';
import https from 'https';

import { CONFIG } from './src/config';
import { evaluateStrategy, calculateDynamicAmount } from './src/strategy';
import { createInitialPositionState, processActivePosition } from './src/tradeManager';
import { logAIDecision } from './src/utils/logger';

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
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

    let position = createInitialPositionState();

    while (true) {
      try {
        const activeAsset = CONFIG.ACTIVE_ASSETS[currentAssetIndex];
        const elapsed = Date.now() - assetStartTime;

        // 4-Hour Shift Window for Hunting Mode
        if (elapsed >= FOUR_HOURS_MS && !position.isHoldingPosition) {
          console.log(`\n🔄 [Pivot Alarm] 4 hours elapsed! Switching focus...`);
          currentAssetIndex = (currentAssetIndex + 1) % CONFIG.ACTIVE_ASSETS.length;
          closePrices = [];
          assetStartTime = Date.now();
          continue;
        }

        // Ticker Fetch
        const ticker = await exchange.fetchTicker(activeAsset);
        const currentPrice = ticker.last as number;
        closePrices.push(currentPrice);
        if (closePrices.length > 50) closePrices.shift();

        // --- MODE A: MONITORING ACTIVE POSITION ---
        if (position.isHoldingPosition) {
          const wasHolding = position.isHoldingPosition;
          position = await processActivePosition(exchange, position, currentPrice);

          // 💡 FIX: If position just closed (TP, SL, or Timeout), IMMEDIATELY pivot to next asset!
          if (wasHolding && !position.isHoldingPosition) {
            console.log(`\n🔄 [Post-Trade Pivot] Trade finished. Rotating to next asset in list...`);
            currentAssetIndex = (currentAssetIndex + 1) % CONFIG.ACTIVE_ASSETS.length;
            closePrices = [];
            assetStartTime = Date.now();
            continue;
          }
        } 
        // --- MODE B: HUNTING FOR STRATEGY CROSSOVER ---
        else {
          const minsRemaining = Math.max(0, ((FOUR_HOURS_MS - elapsed) / 60000)).toFixed(1);
          console.log(`[Hunting: ${activeAsset}] Price: ${currentPrice} | Window: ${closePrices.length}/50 | Next shift: ${minsRemaining} mins`);

          const signal = evaluateStrategy(closePrices, activeAsset);

          if (signal.isSignal) {
            const entryPrice = currentPrice;
            const takeProfitPrice = entryPrice * 1.02; // +2%
            const stopLossPrice = entryPrice * 0.99;   // -1%

            const balanceStructure = await exchange.fetchBalance({ 'type': 'swap' });
            const fetchedBalance = (balanceStructure.free as any)['USDT'] || 0;
            const availableUSDT = fetchedBalance > 0 ? fetchedBalance : 20000;

            const dynamicMargin = availableUSDT * 0.10;
            if (dynamicMargin < 1) continue;

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