import { TradeConfig } from './types';

export const CONFIG: TradeConfig = {
  ACTIVE_ASSETS: [ 
  'BTC/USDT:USDT',   // Bitcoin (Primary/First Priority)
  'DOGE/USDT:USDT', 
  'XRP/USDT:USDT',
  'ETH/USDT:USDT',   // Added Volatile Asset 4
  'AVAX/USDT:USDT',  // Added Volatile Asset 5
  'BNB/USDT:USDT',
  'ZEC/USDT:USDT',   // Privacy / High Volatility Asset
  'BTW/USDT:USDT'    // Bitway Perpetual Swap
],
  LEVERAGE_LIMIT: 20,
  POLL_INTERVAL_MS: 3000,
  RENDER_URL: 'https://weex-ai-wars.onrender.com',
  DRY_RUN: true,
  MEDIUM_HOLD_TIME_MS: 3 * 60 * 60 * 1000,
  MAX_HOLD_TIME_MS: 2 * 60 * 60 * 1000 // Reduced from 6h to 2-hour trade timeout limit
};
