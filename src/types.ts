export interface PositionState {
  isHoldingPosition: boolean;
  activeAsset: string;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tradeAmountUnits: number;
  entryTime: number; // Added for Time-Based Exits
}

export interface TradeConfig {
  ACTIVE_ASSETS: string[];
  LEVERAGE_LIMIT: number;
  POLL_INTERVAL_MS: number;
  RENDER_URL: string;
  DRY_RUN: boolean;
  MAX_HOLD_TIME_MS: number; // e.g. 6 hours
}