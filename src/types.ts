export interface PositionState {
  isHoldingPosition: boolean;
  activeAsset: string;
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  tradeAmountUnits: number;
  entryTime: number; // Added for Time-Based Exits
  lastExitReason?: string; // Tracks why trade exited ("HARD_STOP_LOSS_HIT", "24H_STAGNANT_TIMEOUT", etc.)
}

export interface TradeConfig {
  MAJOR_ASSETS: string[];
  ALT_ASSETS: string[];
  MEME_ASSETS: string[];
  LEVERAGE_LIMIT: number;
  POLL_INTERVAL_MS: number;
  RENDER_URL: string;
  DRY_RUN: boolean;
  MEDIUM_HOLD_TIME_MS: number;
  STAGNANT_TIMEOUT_MS: number;
  MAX_HOLD_TIME_MS: number; // e.g. 2 hours
}
