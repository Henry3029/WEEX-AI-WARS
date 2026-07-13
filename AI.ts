import ccxt from 'ccxt';
import * as dotenv from 'dotenv';
import express from 'express';
import http from 'http';

console.log("===[ ENV DIAGNOSTICS ]===");
console.log("API Key loaded:", process.env.WEEX_API_KEY ? "YES (Length: " + process.env.WEEX_API_KEY.length + ")" : "NO/UNDEFINED");
console.log("Secret loaded:", process.env.WEEX_SECRET_KEY ? "YES" : "NO/UNDEFINED");
console.log("Passphrase loaded:", process.env.WEEX_PASSPHRASE ? "YES" : "NO/UNDEFINED");
console.log("=========================");

// Load environment credentials securely
dotenv.config();

const app = express();
// Render automatically provides a PORT environment variable. Fallback to 3000 locally.
const PORT = process.env.PORT || 3000;


// CONFIGURATION ZONE: Targeted high-volatility assets for the hackathon
const CONFIG = {
    // Easily change your primary weapon here
    ACTIVE_ASSET: 'SOL/USDT:USDT', // Alternates: 'DOGE/USDT:USDT' or 'XRP/USDT:USDT'
    LEVERAGE_LIMIT: 20,            // Strict compliance threshold
    POLL_INTERVAL_MS: 3000,         // Check prices every 3 seconds
RENDER_URL: 'https://your-app-name.onrender.com',
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
        http.get(CONFIG.RENDER_URL, (res) => {
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

        // The Continuous Active Loop
        while (true) {
            try {
                // Fetch the live ticker object wrapper over the internet
                const ticker = await exchange.fetchTicker(CONFIG.ACTIVE_ASSET);
                
                // Dig out the exact last traded price evaluation point
                const currentPrice = ticker.last;
                const dailyChangePercent = ticker.percentage;

                // Format a clear output line for your console dashboard
                const timestamp = new Date().toLocaleTimeString();
                console.log(`[${timestamp}] Asset: ${CONFIG.ACTIVE_ASSET} | Price: $${currentPrice} | 24h Change: ${dailyChangePercent}%`);

                /* 
                  Future AI Strategy Zone:
                  This is exactly where your algorithm will evaluate if 
                  it's time to open a position (Long/Short) based on price movements.
                */

// ════════════ PLACE THE SAFETY GATE HERE ════════════
                if (CONFIG.DRY_RUN) {
                    // When you write your trading logic later, it stops here safely
                    // console.log("[SIMULATION] Safety gate active. No real funds used.");
                } else {
                    // This is where real CCXT order execution commands will go later
                }
                // ═════════════════════════════════════════════════════

            } catch (networkError: any) {
                // If a packet drops or a temporary network error occurs, log it but DON'T let the bot crash
                console.warn(`[Network Warning] Failed to fetch ticker data: ${networkError.message}. Retrying...`);
            }

            // Pause the execution loop smoothly for your specified time interval (3 seconds)
            await new Promise(resolve => setTimeout(resolve, CONFIG.POLL_INTERVAL_MS));
        }

    } catch (criticalError: any) {
        console.error("❌ CRITICAL: Engine initialization failed:", criticalError.message);
        process.exit(1);
    }
}

// Fire the active engine script
startTradingEngine();