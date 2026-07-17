import ccxt from 'ccxt';
import * as dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import https from 'https';
import { logAIDecision, ExecutionRecord } from './src/utils/logger'; 
import { EMA, RSI } from 'technicalindicators';

// Load environment credentials securely
dotenv.config(); 

console.log("===[ ENV DIAGNOSTICS ]===");
console.log("API Key loaded:", process.env.WEEX_API_KEY ? "YES (Length: " + process.env.WEEX_API_KEY.length + ")" : "NO/UNDEFINED");
console.log("Secret loaded:", process.env.WEEX_SECRET_KEY ? "YES" : "NO/UNDEFINED");
console.log("Passphrase loaded:", process.env.WEEX_PASSPHRASE ? "YES" : "NO/UNDEFINED");
console.log("=========================");

const app = express();
// Render automatically provides a PORT environment variable. Fallback to 3000 locally.
const PORT = process.env.PORT || 3000;


// CONFIGURATION ZONE: Targeted high-volatility assets for the hackathon
const CONFIG = {
    // Easily change your primary weapon here
    ACTIVE_ASSETS: ['SOL/USDT:USDT', 'DOGE/USDT:USDT', 'XRP/USDT:USDT'], // Alternates: 'DOGE/USDT:USDT' or 'XRP/USDT:USDT'
    LEVERAGE_LIMIT: 20,            // Strict compliance threshold
    POLL_INTERVAL_MS: 3000,         // Check prices every 3 seconds
RENDER_URL: 'https://weex-ai-wars.onrender.com',
DRY_RUN: true
};


// 1. LIGHTWEIGHT WEB PORT (Satisfies Render's web service requirement)
app.get('/', (req, res) => {
    res.send({ status: "online", engine: "WEEX AI Wars Bot Active" });
});

app.listen(PORT, () => {
    console.log(`[Web Server] Operational on port ${PORT}`);
});

// 2. THE ANTI-SLEEP SELF-PING LOOP
function startSelfPinger() {
    // Ping every 10 minutes (600,000 milliseconds) to beat the 15-minute timeout
    setInterval(() => {
        if (CONFIG.RENDER_URL.includes('your-app-name')) {
            console.log('[Pinger] Skipping self-ping: RENDER_URL not configured yet.');
            return;
        }

console.log(`[Pinger] Firing self-ping to keep container awake...`);
        https.get(CONFIG.RENDER_URL, (res) => {
            console.log(`[Pinger] Response status received: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`[Pinger] Ping failed:`, err.message);
        });
    }, 600000); 
}

// 1. Place this dynamic function outside your engine
function calculateDynamicAmount(exchange: any, asset: string, currentPrice: number, targetMarginUSD: number, leverage: number): number {
    // Total buying power = Margin allocated * Leverage
    const totalBuyingPower = targetMarginUSD * leverage;
    const rawTokenAmount = totalBuyingPower / currentPrice;

    // Use CCXT's native market metadata to truncate decimals correctly for WEEX
    const market = exchange.market(asset);
    
    // exchange.amountToPrecision ensures the exchange won't reject your order due to decimal errors
    const precisionAmountStr = exchange.amountToPrecision(asset, rawTokenAmount);
    
    return parseFloat(precisionAmountStr);
}

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

        let currentAssetIndex = 0;
        let closePrices: number[] = [];
        let assetStartTime = Date.now();
        const FOUR_HOURS_MS = 4 * 60 * 60 * 1000; 

        // ════════════ NEW POSITION TRACKING STATE ════════════
        let isHoldingPosition = false;
        let entryPrice = 0;
        let takeProfitPrice = 0;
        let stopLossPrice = 0;
        let tradeAmountUnits = 0;
        // ═════════════════════════════════════════════════════

        for (const asset of CONFIG.ACTIVE_ASSETS) {
            await exchange.setLeverage(CONFIG.LEVERAGE_LIMIT, asset);
        }

        startSelfPinger();
        console.log("Engine booted. Ready to cycle targets every 4 hours.\n");

        while (true) {
            try {
                const activeAsset = CONFIG.ACTIVE_ASSETS[currentAssetIndex];

                // --- 4-HOUR PIVOT CHECK ---
                const elapsed = Date.now() - assetStartTime;
                
                // CRITICAL RISK RULE: Do NOT switch assets if we are currently stuck in an active live trade!
                if (elapsed >= FOUR_HOURS_MS && !isHoldingPosition) {
                    console.log(`\n🔄 [Pivot Alarm] 4 hours elapsed! Switching focus...`);
                    currentAssetIndex = (currentAssetIndex + 1) % CONFIG.ACTIVE_ASSETS.length;
                    const newAsset = CONFIG.ACTIVE_ASSETS[currentAssetIndex];
                    
                    console.log(`🎯 New Target Locked: [ ${newAsset} ]`);
                    closePrices = []; 
                    assetStartTime = Date.now(); 
                    continue; 
                } else if (elapsed >= FOUR_HOURS_MS && isHoldingPosition) {
                    // Remind us that the timer went off, but we are waiting on a trade resolution
                    console.log(`⚠️ [Pivot Delayed] 4 hours passed, but holding an active trade on ${activeAsset}. Postponing shift.`);
                    assetStartTime = Date.now(); // Postpone timer slightly so it doesn't spam logs
                }

                // --- FETCH CURRENT MARKET PRICE ---
                const ticker = await exchange.fetchTicker(activeAsset);
                const currentPrice = ticker.last as number;
                
                closePrices.push(currentPrice);
                if (closePrices.length > 50) { closePrices.shift(); }

              // --- MODE A: MONITORING AN ACTIVE POSITION ---
if (isHoldingPosition) {
    console.log(`[TRADE ACTIVE: ${activeAsset}] Current: $${currentPrice} | TP: $${takeProfitPrice.toFixed(2)} | SL: $${stopLossPrice.toFixed(2)}`);

    // 1. Check Take Profit Target
    if (currentPrice >= takeProfitPrice) {
        console.log(`\n💰💰💰 [TAKE PROFIT HIT] Closing position for ${activeAsset} at $${currentPrice}!`);
        
        if (!CONFIG.DRY_RUN) {
            try {
                // Use the tracked units to close the position perfectly
                await exchange.createMarketSellOrder(activeAsset, tradeAmountUnits);
                console.log(`✅ Position fully exited into cash profit.`);
            } catch (exitError: any) {
                console.error(`❌ Critical: Failed to close position at profit target: ${exitError.message}`);
            }
        }

        // Reset tracking states
        isHoldingPosition = false; 
        tradeAmountUnits = 0; // Clear units
        closePrices = []; 
    } 
    // 2. Check Stop Loss Target
    else if (currentPrice <= stopLossPrice) {
        console.log(`\n🛡️🛡️🛡️ [STOP LOSS HIT] Safeguarding funds. Closing ${activeAsset} at $${currentPrice}.`);
        
        if (!CONFIG.DRY_RUN) {
            try {
                // Use the tracked units to close the position perfectly
                await exchange.createMarketSellOrder(activeAsset, tradeAmountUnits);
                console.log(`🛡️ Position exited to prevent further loss.`);
            } catch (exitError: any) {
                console.error(`❌ Critical: Failed to execute stop loss order: ${exitError.message}`);
            }
        }

        // Reset tracking states
        isHoldingPosition = false; 
        tradeAmountUnits = 0; // Clear units
        closePrices = []; 
    }
}
                // --- MODE B: HUNTING FOR A STRATEGY CROSSOVER ---
                else {
                    const minutesRemaining = Math.max(0, ((FOUR_HOURS_MS - elapsed) / 60000)).toFixed(1);
                    console.log(`[Hunting: ${activeAsset}] Price: ${currentPrice} | Window: ${closePrices.length}/50 | Next shift in: ${minutesRemaining} mins`);

                    if (closePrices.length >= 20) {
                        const emaFastArray = EMA.calculate({ period: 5, values: closePrices });
                        const emaSlowArray = EMA.calculate({ period: 13, values: closePrices });
                        
                        const currentEmaFast = emaFastArray[emaFastArray.length - 1];
                        const currentEmaSlow = emaSlowArray[emaSlowArray.length - 1];
                        const prevEmaFast = emaFastArray[emaFastArray.length - 2];
                        const prevEmaSlow = emaSlowArray[emaSlowArray.length - 2];

                        const rsiArray = RSI.calculate({ period: 14, values: closePrices });
                        const currentRSI = rsiArray[rsiArray.length - 1];

                        const isEmaCrossover = (prevEmaFast <= prevEmaSlow) && (currentEmaFast > currentEmaSlow);
                        const isNotOverbought = currentRSI < 65;

                      if (isEmaCrossover && isNotOverbought) {
    const signal = `EMA_CROSSOVER_BUY`;
    const reason = `[${activeAsset}] Fast EMA (5) crossed above Slow EMA (13). RSI is at ${currentRSI.toFixed(1)}.`;

    entryPrice = currentPrice;
    takeProfitPrice = entryPrice * 1.02; // +2% target
    stopLossPrice = entryPrice * 0.99;   // -1% protection

    // 1. DYNAMIC BALANCE CHECKS: Query the exchange for your active futures wallet status
    const balanceStructure = await exchange.fetchBalance({ 'type': 'swap' });
    const availableUSDT = (balanceStructure.free as any)['USDT'] || 0;
    
    // 2. ALLOCATION RULE: Risk exactly 10% of your active wallet equity on this position
    const dynamicMargin = availableUSDT * 0.10; 

    if (dynamicMargin < 1) { // Safety buffer: Skip if your wallet has literally cents left
        console.warn(`⚠️ Available futures balance is too low to trade ($${availableUSDT.toFixed(2)} USDT). Skipping trade.`);
        continue;
    }

    // 3. PRECISION CALCULATIONS: Pass our metrics into your dynamic helper function
    const tradeAmount = calculateDynamicAmount(
        exchange, 
        activeAsset, 
        currentPrice, 
        dynamicMargin, 
        CONFIG.LEVERAGE_LIMIT
    );

    if (tradeAmount === 0) {
        console.warn(`⚠️ Generated token unit amount is below exchange precision minimums for ${activeAsset}. Skipping.`);
        continue;
    }

    let liveOrderId: string | undefined = "SIMULATED_ID";

    // 4. LIVE TRANSACTION ENGINE
    if (!CONFIG.DRY_RUN) {
        try {
            console.log(`📡 [EXECUTION] Firing LIVE Market Buy to WEEX: ${tradeAmount} units of ${activeAsset}`);
            
            // Firing actual market order to exchange orderbook
            const order = await exchange.createMarketBuyOrder(activeAsset, tradeAmount);
            liveOrderId = order.id;
            
            console.log(`🚀 [LIVE ORDER EXECUTION SUCCESS] ID: ${liveOrderId}`);
        } catch (tradeError: any) {
            console.error(`❌ [WEEX REJECTION] Order failed to register on exchange:`, tradeError.message);
            isHoldingPosition = false; 
            continue; // Skip this loop tick, don't trap the bot
        }
    } else {
        console.log(`🧪 [DRY_RUN ACTIVE] Simulating entry at $${entryPrice} using $${dynamicMargin.toFixed(2)} margin for ${tradeAmount} units.`);
    }

    // 5. LOCK ONTO THE TRADE
    isHoldingPosition = true; 
    tradeAmountUnits = tradeAmount;

    const executionRecord = {
        mode: CONFIG.DRY_RUN ? "DRY_RUN_SIMULATION" : "LIVE",
        orderId: liveOrderId,
        asset: activeAsset,
        action: "BUY_LONG",
        allocatedMargin: dynamicMargin.toFixed(2),
        amountUnits: tradeAmount,
        executionPrice: entryPrice,
        riskManagement: {
            calculatedStopLoss: stopLossPrice.toFixed(2),
            calculatedTakeProfit: takeProfitPrice.toFixed(2),
            ratio: "2:1"
        },
        indicators: {
            fastEma: currentEmaFast.toFixed(2),
            slowEma: currentEmaSlow.toFixed(2),
            rsi: currentRSI.toFixed(1)
        },
        status: "POSITION_OPENED"
    };

    logAIDecision(signal, reason, executionRecord);
}
                    }
                }

            } catch (networkError: any) {
                console.warn(`[Network Warning] Failed to fetch ticker: ${networkError.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
        }

    } catch (criticalError: any) {
        console.error("❌ CRITICAL: Engine initialization failed:", criticalError.message);
        process.exit(1);
    }
}

// Fire the active engine script
startTradingEngine();