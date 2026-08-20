import { TradeConfig } from './types';

export const CONFIG: TradeConfig = {
  MAJOR_ASSETS: [
    'BTC/USDT:USDT',
    'ETH/USDT:USDT',
    'BNB/USDT:USDT'
  ],
  ALT_ASSETS: [
    'DOGE/USDT:USDT',
    'XRP/USDT:USDT',
    'AVAX/USDT:USDT',
    'ZEC/USDT:USDT',
    'BTW/USDT:USDT'
  ],
  LEVERAGE_LIMIT: 20,
  POLL_INTERVAL_MS: 3000,
  RENDER_URL: 'https://weex-ai-wars.onrender.com',
  DRY_RUN: true,
  MEDIUM_HOLD_TIME_MS: 3 * 60 * 60 * 1000,
  STAGNANT_TIMEOUT_MS: 24 * 60 * 60 * 1000,
  MAX_HOLD_TIME_MS: 2 * 60 * 60 * 1000 // 2-hour trade timeout limit
};
