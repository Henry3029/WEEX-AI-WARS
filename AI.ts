import ccxt from 'ccxt';
import * as dotenv from 'dotenv';

// Load the secret keys from the .env file into memory
dotenv.config();

async function initializeBot() {
    // Connect using hidden environment variables
    const exchange = new ccxt.weex({
        'apiKey': process.env.WEEX_API_KEY,
        'secret': process.env.WEEX_SECRET_KEY,
        'password': process.env.WEEX_PASSPHRASE,
    });

    try {
        console.log("Connecting to WEEX API safely...");
        await exchange.loadMarkets();
        
        const ticker = await exchange.fetchTicker('BTC/USDT');
        console.log(`Live Test -> Current BTC Price: $${ticker.last}`);
    } catch (error: any) {
        console.error("Connection failed:", error.message);
    }
}

initializeBot();