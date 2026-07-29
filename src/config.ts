import { TradeConfig } from './types';

export const CONFIG: TradeConfig = {
  ACTIVE_ASSETS: ['SOL/USDT:USDT', 'DOGE/USDT:USDT', 'XRP/USDT:USDT'],
  LEVERAGE_LIMIT: 20,
  POLL_INTERVAL_MS: 3000,
  RENDER_URL: 'https://weex-ai-wars.onrender.com',
  DRY_RUN: true,
  MAX_HOLD_TIME_MS: 6 * 60 * 60 * 1000 // 6-hour trade timeout limit
};