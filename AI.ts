import ccxt from 'ccxt';
import * as dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import https from 'https';
import { logAIDecision } from '../utils/logger'; 
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
    ACTIVE_ASSET: 'SOL/USDT:USDT', // Alternates: 'DOGE/USDT:USDT' or 'XRP/USDT:USDT'
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
    // Initialize connection handler with your private key array
    const exchange = new ccxt.weex({
        'apiKey': process.env.WEEX_API_KEY,
        'secret': process.env.WEEX_SECRET_KEY,
        'password': process.env.WEEX_PASSPHRASE,
        'timeout': 10000,
        'options': {
            'defaultType': 'swap', // Locks into the perpetual swap database engine
        }
    });
    
  

    try {
        console.log("╔══════════════════════════════════════════════════════╗");
        console.log("║           WEEX AI WARS ENGINE ACTIVATED              ║");
        console.log("╚══════════════════════════════════════════════════════╝");
        
        console.log("Connecting to WEEX API and fetching market structures...");
        await exchange.loadMarkets();

        // Safety Pre-flight: Set your leverage limit BEFORE launching live tracking
        console.log(`Configuring safety guardrails... Setting leverage to ${CONFIG.LEVERAGE_LIMIT}x for ${CONFIG.ACTIVE_ASSET}`);
        await exchange.setLeverage(CONFIG.LEVERAGE_LIMIT, CONFIG.ACTIVE_ASSET);
        console.log("Leverage constraints locked successfully.\n");

// Activate the anti-sleep mechanism
        startSelfPinger();

        console.log(`Starting continuous monitoring stream on high-volatility target [ ${CONFIG.ACTIVE_ASSET} ]`);
        console.log("Press Ctrl+C inside Termux/Terminal to stop the engine.\n");

     // Initialise arrays outside your loop
const closePrices: number[] = [];

while (true) {
    try {
        const ticker = await exchange.fetchTicker(CONFIG.ACTIVE_ASSET);
        const currentPrice = ticker.last;
        
        // Add the new price to our dataset
        closePrices.push(currentPrice);
        if (closePrices.length > 50) {
            closePrices.shift(); // Keep a healthy window of 50 prices for accurate indicators
        }

        // We need enough data to calculate our indicators
        if (closePrices.length >= 20) {
            
            // 1. Calculate EMAs
            const emaFastArray = EMA.calculate({ period: 5, values: closePrices });
            const emaSlowArray = EMA.calculate({ period: 13, values: closePrices });
            
            // Get the most recent EMA values
            const currentEmaFast = emaFastArray[emaFastArray.length - 1];
            const currentEmaSlow = emaSlowArray[emaSlowArray.length - 1];
            
            // Get the previous EMA values (to detect a crossover!)
            const prevEmaFast = emaFastArray[emaFastArray.length - 2];
            const prevEmaSlow = emaSlowArray[emaSlowArray.length - 2];

            // 2. Calculate RSI
            const rsiArray = RSI.calculate({ period: 14, values: closePrices });
            const currentRSI = rsiArray[rsiArray.length - 1];

            // 3. The Winning Logic:
            // - Did the fast EMA cross ABOVE the slow EMA? (Trend reversal upward)
            // - Is the market NOT overbought yet? (RSI < 65)
            const isEmaCrossover = (prevEmaFast <= prevEmaSlow) && (currentEmaFast > currentEmaSlow);
            const isNotOverbought = currentRSI < 65;

            if (isEmaCrossover && isNotOverbought) {
                const signal = `EMA_CROSSOVER_BUY`;
                const reason = `Fast EMA (5) crossed above Slow EMA (13). RSI is at ${currentRSI.toFixed(1)} (Healthy momentum).`;

                const executionRecord = {
                    mode: CONFIG.DRY_RUN ? "DRY_RUN_SIMULATION" : "LIVE",
                    asset: CONFIG.ACTIVE_ASSET,
                    action: "BUY_LONG",
                    executionPrice: currentPrice,
                    indicators: {
                        fastEma: currentEmaFast.toFixed(2),
                        slowEma: currentEmaSlow.toFixed(2),
                        rsi: currentRSI.toFixed(1)
                    },
                    status: "COMPLETED"
                };

                // Trigger your beautiful logging function!
                logAIDecision(signal, reason, executionRecord);
            }
        }

    } catch (networkError: any) {
        console.warn(`[Network Warning] Failed to fetch ticker data: ${networkError.message}. Retrying...`);
    }

    // Your 7-second pause
    await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
}

    } catch (criticalError: any) {
        console.error("❌ CRITICAL: Engine initialization failed:", criticalError.message);
        process.exit(1);
    }
}

// Fire the active engine script
startTradingEngine();