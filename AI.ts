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

        // 1. Initialize our single tracking window
        let currentAssetIndex = 0;
        let closePrices: number[] = [];
        
        // Track the timestamp of when we started monitoring the current asset
        let assetStartTime = Date.now();
        const FOUR_HOURS_MS = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

        // Configure leverage limit for all of them upfront
        for (const asset of CONFIG.ACTIVE_ASSETS) {
            await exchange.setLeverage(CONFIG.LEVERAGE_LIMIT, asset);
        }

        startSelfPinger();

        console.log("Engine booted. Ready to cycle targets every 4 hours.\n");

        while (true) {
            try {
                // Get the currently active asset from our array
                const activeAsset = CONFIG.ACTIVE_ASSETS[currentAssetIndex];

                // --- 4-HOUR PIVOT CHECK ---
                const elapsed = Date.now() - assetStartTime;
                if (elapsed >= FOUR_HOURS_MS) {
                    console.log(`\n🔄 [Pivot Alarm] 4 hours elapsed! Switching focus...`);
                    
                    // Move to the next asset index (loops back to 0 if at the end of the array)
                    currentAssetIndex = (currentAssetIndex + 1) % CONFIG.ACTIVE_ASSETS.length;
                    const newAsset = CONFIG.ACTIVE_ASSETS[currentAssetIndex];
                    
                    console.log(`🎯 New Target Locked: [ ${newAsset} ]`);
                    
                    // CRITICAL: Clear the price history so the old asset's prices don't mix with the new one!
                    closePrices = []; 
                    assetStartTime = Date.now(); // Reset the 4-hour timer
                    
                    continue; // Skip the rest of this tick and fetch the new asset immediately
                }

                // --- MAIN TRADING ENGINE LOGIC ---
                const ticker = await exchange.fetchTicker(activeAsset);
                const currentPrice = ticker.last as number;
                
                closePrices.push(currentPrice);
                if (closePrices.length > 50) {
                    closePrices.shift();
                }

                // Log target status so you can see how long is left in the 4-hour window
                const minutesRemaining = Math.max(0, ((FOUR_HOURS_MS - elapsed) / 60000)).toFixed(1);
                console.log(`[Tracking: ${activeAsset}] Price: ${currentPrice} | Window: ${closePrices.length}/50 | Next switch in: ${minutesRemaining} mins`);

                if (closePrices.length >= 20) {
                    // 1. Calculate EMAs
                    const emaFastArray = EMA.calculate({ period: 5, values: closePrices });
                    const emaSlowArray = EMA.calculate({ period: 13, values: closePrices });
                    
                    const currentEmaFast = emaFastArray[emaFastArray.length - 1];
                    const currentEmaSlow = emaSlowArray[emaSlowArray.length - 1];
                    const prevEmaFast = emaFastArray[emaFastArray.length - 2];
                    const prevEmaSlow = emaSlowArray[emaSlowArray.length - 2];

                    // 2. Calculate RSI
                    const rsiArray = RSI.calculate({ period: 14, values: closePrices });
                    const currentRSI = rsiArray[rsiArray.length - 1];

                    // 3. Strategy Evaluation
                    const isEmaCrossover = (prevEmaFast <= prevEmaSlow) && (currentEmaFast > currentEmaSlow);
                    const isNotOverbought = currentRSI < 65;

                    if (isEmaCrossover && isNotOverbought) {
                        const signal = `EMA_CROSSOVER_BUY`;
                        const reason = `[${activeAsset}] Fast EMA (5) crossed above Slow EMA (13). RSI is at ${currentRSI.toFixed(1)}.`;

                        const executionRecord = {
                            mode: CONFIG.DRY_RUN ? "DRY_RUN_SIMULATION" : "LIVE",
                            asset: activeAsset,
                            action: "BUY_LONG",
                            executionPrice: currentPrice,
                            indicators: {
                                fastEma: currentEmaFast.toFixed(2),
                                slowEma: currentEmaSlow.toFixed(2),
                                rsi: currentRSI.toFixed(1)
                            },
                            status: "COMPLETED"
                        };

                        logAIDecision(signal, reason, executionRecord);
                    }
                }

            } catch (networkError: any) {
                console.warn(`[Network Warning] Failed to fetch ticker: ${networkError.message}`);
            }

            // Pause for your standard poll interval before checking the price again
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
        }

    } catch (criticalError: any) {
        console.error("❌ CRITICAL: Engine initialization failed:", criticalError.message);
        process.exit(1);
    }
}

// Fire the active engine script
startTradingEngine();