import { TradeConfig } from './types';

export const CONFIG: TradeConfig = {
  ACTIVE_ASSETS: [ 
    'DOGE/USDT:USDT', 
    'XRP/USDT:USDT',
    'ETH/USDT:USDT',   // Added Volatile Asset 4
    'AVAX/USDT:USDT',   // Added Volatile Asset 5
    'BNB/USDT:USDT'
  ],
  LEVERAGE_LIMIT: 20,
  POLL_INTERVAL_MS: 3000,
  RENDER_URL: 'https://weex-ai-wars.onrender.com',
  DRY_RUN: false,
  MAX_HOLD_TIME_MS: 3 * 60 * 60 * 1000 // Reduced from 6h to 3-hour trade timeout limit
};
