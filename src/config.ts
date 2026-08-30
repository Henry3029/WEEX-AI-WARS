import { TradeConfig } from './types';

export const CONFIG: TradeConfig = {
  MAJOR_ASSETS: [
    'BTC/USDT:USDT',
    'ETH/USDT:USDT'
  ],
  ALT_ASSETS: [
    'BNB/USDT:USDT',
    'DOGE/USDT:USDT',
     'XRP/USDT:USDT'
  ],
  MEME_ASSETS: [
    'AVAX/USDT:USDT',
    'ZEC/USDT:USDT',
    'BTW/USDT:USDT',
    '1000PEPE/USDT:USDT'
  ],
  
  // Market Floor & Minimum Precision Registry
  ASSET_RULES: {
    'ZEC': { minLot: 0.1, integerOnly: false },
    'BTW': { minLot: 100.0, integerOnly: true },
   '1000PEPE': { minLot: 1.0, integerOnly: true },
    'DEFAULT': { minLot: 0.001, integerOnly: false }
  },
  
  
  LEVERAGE_LIMIT: 20,
  POLL_INTERVAL_MS: 3000,
  RENDER_URL: 'https://weex-ai-wars.onrender.com',
  DRY_RUN: false,
  MEDIUM_HOLD_TIME_MS: 3 * 60 * 60 * 1000,
  STAGNANT_TIMEOUT_MS: 24 * 60 * 60 * 1000,
  MAX_HOLD_TIME_MS: 2 * 60 * 60 * 1000
};
