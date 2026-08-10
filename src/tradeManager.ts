import { PositionState } from './types';
import { CONFIG } from './config';
import { logAIDecision } from './utils/logger';

export interface ExtendedPositionState extends PositionState {
  hasTakenPartialProfit?: boolean;
  highestPriceSinceEntry?: number;
}

// Helper to format milliseconds into readable "0h 12m 30s" or "45m 10s"
function formatDuration(ms: number): string {
  if (ms <= 0) return '0m 0s';
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

export function createInitialPositionState(): ExtendedPositionState {
  return {
    isHoldingPosition: false,
    activeAsset: '',
    entryPrice: 0,
    takeProfitPrice: 0,
    stopLossPrice: 0,
    tradeAmountUnits: 0,
    entryTime: 0,
    hasTakenPartialProfit: false,
    highestPriceSinceEntry: 0
  };
}

export async function processActivePosition(
  exchange: any,
  position: ExtendedPositionState,
  currentPrice: number
): Promise<ExtendedPositionState> {
  const { 
    activeAsset, 
    takeProfitPrice, 
    stopLossPrice, 
    tradeAmountUnits, 
    entryTime, 
    entryPrice,
    hasTakenPartialProfit = false,
    highestPriceSinceEntry = 0
  } = position;

  // Clean symbol formatting (e.g., DOGE/USDT:USDT -> DOGE/USDT)
  const cleanAsset = activeAsset.split(':')[0];

  const elapsedTimeMs = Date.now() - entryTime;
  const timeHeldFormatted = formatDuration(elapsedTimeMs);
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  // Track peak price hit during trade
  const currentHighestPrice = Math.max(highestPriceSinceEntry, currentPrice, entryPrice);

  // Timeouts Configuration
  const MAIN_TIMEOUT_MS = CONFIG.MAX_HOLD_TIME_MS; // e.g. 4 Hours
  const MEDIUM_TIMEOUT_MS = CONFIG.MEDIUM_HOLD_TIME_MS || (MAIN_TIMEOUT_MS + (3 * 60 * 60 * 1000)); // e.g. 7 Hours

  // Calculate remaining countdown time
  let countdownLog = '';
  if (elapsedTimeMs < MAIN_TIMEOUT_MS) {
    const timeToMainTimeout = MAIN_TIMEOUT_MS - elapsedTimeMs;
    countdownLog = `Main Timeout in: ${formatDuration(timeToMainTimeout)}`;
  } else if (elapsedTimeMs < MEDIUM_TIMEOUT_MS) {
    const timeToMediumTimeout = MEDIUM_TIMEOUT_MS - elapsedTimeMs;
    countdownLog = `Medium Timeout in: ${formatDuration(timeToMediumTimeout)}`;
  } else {
    countdownLog = `Infinite Soft Exit Hold Active`;
  }

  // Updated Log matching terminal layout with Held time & Countdown
  console.log(
    `[TRADE ACTIVE: ${cleanAsset}] Price: $${currentPrice} | Peak: $${currentHighestPrice.toFixed(4)} | ` +
    `SL/TS: $${stopLossPrice.toFixed(4)} | PnL: ${priceChangePct.toFixed(2)}% | Partial TP: ${hasTakenPartialProfit} | ` +
    `Held: ${timeHeldFormatted} | (${countdownLog})`
  );

  // -------------------------------------------------------------
  // 1. PARTIAL TAKE PROFIT (+2.00% Move -> Sell 50% & Enable Trailing)
  // -------------------------------------------------------------
  const partialTpPrice = entryPrice * 1.0200;

  if (!hasTakenPartialProfit && currentPrice >= partialTpPrice) {
    const halfUnits = tradeAmountUnits / 2;
    console.log(
      `\n🚀🚀🚀 [PARTIAL TP HIT] Selling 50% of ${cleanAsset} at $${currentPrice} (+2.00% Gain)!` +
      ` Moving SL to Breakeven ($${entryPrice.toFixed(4)}) & Enabling Trailing Stop.`
    );

    await executeSell(exchange, activeAsset, halfUnits, "PARTIAL_TP_50_PERCENT");

    return {
      ...position,
      tradeAmountUnits: tradeAmountUnits - halfUnits,
      stopLossPrice: entryPrice,
      hasTakenPartialProfit: true,
      highestPriceSinceEntry: currentPrice
    };
  }

  // -------------------------------------------------------------
  // 2. DYNAMIC TRAILING STOP ADJUSTMENT (Only after Partial TP)
  // -------------------------------------------------------------
  let updatedStopLoss = stopLossPrice;

  if (hasTakenPartialProfit) {
    const TRAILING_DISTANCE_PCT = 0.0050; // 0.50% Trailing Distance
    const calculatedTrailingStop = currentHighestPrice * (1 - TRAILING_DISTANCE_PCT);

    if (calculatedTrailingStop > stopLossPrice) {
      updatedStopLoss = calculatedTrailingStop;
      console.log(
        `📈 [TRAILING STOP UPDATED] Peak: $${currentHighestPrice.toFixed(4)} | ` +
        `New Trailing SL: $${updatedStopLoss.toFixed(4)}`
      );
    }
  }

  // -------------------------------------------------------------
  // 3. STOP LOSS / TRAILING STOP EXECUTION
  // -------------------------------------------------------------
  if (currentPrice <= updatedStopLoss) {
    const slReason = hasTakenPartialProfit ? "TRAILING_STOP_HIT" : "HARD_STOP_LOSS_HIT";
    console.log(`\n🛡️🛡️🛡️ [${slReason}] Closing remaining ${cleanAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, slReason);
    return createInitialPositionState();
  }

  // -------------------------------------------------------------
  // 4. TIME-BASED CASCADING TIMEOUTS (Skipped if Bullish / Profit >= +0.50%)
  // -------------------------------------------------------------
  const isBullishOverride = priceChangePct >= 0.50;

  if (isBullishOverride) {
    console.log(`🔥 [BULLISH OVERRIDE] Price is up +${priceChangePct.toFixed(2)}%. Bypassing time-based exits.`);
    return {
      ...position,
      stopLossPrice: updatedStopLoss,
      highestPriceSinceEntry: currentHighestPrice
    };
  }

  if (elapsedTimeMs >= MEDIUM_TIMEOUT_MS) {
    const softExitPrice = entryPrice * 1.0020; // +0.20%
    if (currentPrice >= softExitPrice) {
      console.log(`\n⏳ [SOFT EXIT] Held ${timeHeldFormatted} (Past 7h Medium Timeout). Exiting at +0.20%.`);
      await executeSell(exchange, activeAsset, tradeAmountUnits, "SOFT_TIMEOUT_PROFIT");
      return createInitialPositionState();
    }
  } else if (elapsedTimeMs >= MAIN_TIMEOUT_MS) {
    const mainTimeoutPrice = entryPrice * 1.0100; // +1.00%
    if (currentPrice >= mainTimeoutPrice) {
      console.log(`\n⏳ [MAIN TIMEOUT EXIT] Held ${timeHeldFormatted} (Past 4h Main Timeout). Exiting at +1.00%.`);
      await executeSell(exchange, activeAsset, tradeAmountUnits, "MAIN_TIMEOUT_PROFIT");
      return createInitialPositionState();
    }
  }

  return {
    ...position,
    stopLossPrice: updatedStopLoss,
    highestPriceSinceEntry: currentHighestPrice
  };
}

async function executeSell(exchange: any, asset: string, units: number, reason: string) {
  if (!CONFIG.DRY_RUN) {
    try {
      await exchange.createMarketSellOrder(asset, units, {
        'reduceOnly': true,
        'positionSide': 'LONG'
      });
      console.log(`✅ [LIVE SELL SUCCESS] Exit Reason: ${reason}`);
    } catch (exitError: any) {
      console.error(`❌ Critical: Failed to execute sell order: ${exitError.message}`);
    }
  } else {
    console.log(`🧪 [DRY_RUN] Simulated sell of ${units} units of ${asset}. Reason: ${reason}`);
  }

  logAIDecision(reason, `Exited ${asset} position.`, { asset, units, mode: CONFIG.DRY_RUN ? 'DRY_RUN' : 'LIVE' });
    }
