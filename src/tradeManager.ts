import { PositionState } from './types';
import { CONFIG } from './config';
import { logAIDecision } from './utils/logger';

export interface ExtendedPositionState extends PositionState {
  hasTakenPartialProfit?: boolean;
  highestPriceSinceEntry?: number; // Tracks highest price hit during trade for Trailing Stop
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

  const elapsedTimeMs = Date.now() - entryTime;
  const hoursHeld = (elapsedTimeMs / (1000 * 60 * 60)).toFixed(2);
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  // Track the highest price reached during the lifetime of this trade
  const currentHighestPrice = Math.max(highestPriceSinceEntry, currentPrice, entryPrice);

  console.log(
    `[TRADE ACTIVE: ${activeAsset}] Price: $${currentPrice} | Peak: $${currentHighestPrice.toFixed(4)} | ` +
    `SL/TS: $${stopLossPrice.toFixed(4)} | PnL: ${priceChangePct.toFixed(2)}% | Partial TP: ${hasTakenPartialProfit}`
  );

  // -------------------------------------------------------------
  // 1. PARTIAL TAKE PROFIT (+2.00% Move -> Sell 50% & Activate Trailing)
  // -------------------------------------------------------------
  const partialTpPrice = entryPrice * 1.0200; // +2.00% Gain Target

  if (!hasTakenPartialProfit && currentPrice >= partialTpPrice) {
    const halfUnits = tradeAmountUnits / 2;
    console.log(
      `\n🚀🚀🚀 [PARTIAL TP HIT] Selling 50% of ${activeAsset} at $${currentPrice} (+2.00% Gain)!` +
      ` Moving Stop Loss to Breakeven ($${entryPrice.toFixed(4)}) & Enabling Trailing Stop.`
    );

    await executeSell(exchange, activeAsset, halfUnits, "PARTIAL_TP_50_PERCENT");

    // Initial trailing stop set at Breakeven (entry price)
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
    const TRAILING_DISTANCE_PCT = 0.0050; // 0.50% trailing drop allowance
    const calculatedTrailingStop = currentHighestPrice * (1 - TRAILING_DISTANCE_PCT);

    // Only move Stop Loss UP, never down
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
    console.log(`\n🛡️🛡️🛡️ [${slReason}] Closing remaining ${activeAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, slReason);
    return createInitialPositionState();
  }

  // -------------------------------------------------------------
  // 4. TIME-BASED TIMEOUTS (Skipped if trade is in active profit / bullish)
  // -------------------------------------------------------------
  const isBullishOverride = priceChangePct >= 0.50; // Pause timeouts while up +0.50% or more

  if (isBullishOverride) {
    console.log(`🔥 [BULLISH OVERRIDE] Price is up +${priceChangePct.toFixed(2)}%. Bypassing time-based exits.`);
    return {
      ...position,
      stopLossPrice: updatedStopLoss,
      highestPriceSinceEntry: currentHighestPrice
    };
  }

  // Cascading Timeouts (only apply if price fails to gain momentum)
  const MAIN_TIMEOUT_MS = CONFIG.MAX_HOLD_TIME_MS; // 4 Hours
  const MEDIUM_TIMEOUT_MS = CONFIG.MEDIUM_HOLD_TIME_MS || (MAIN_TIMEOUT_MS + (3 * 60 * 60 * 1000)); // 7 Hours

  if (elapsedTimeMs >= MEDIUM_TIMEOUT_MS) {
    const softExitPrice = entryPrice * 1.0020; // +0.20%
    if (currentPrice >= softExitPrice) {
      console.log(`\n⏳ [SOFT EXIT] Held ${hoursHeld}h (Past 7h Medium Timeout). Exiting at +0.20%.`);
      await executeSell(exchange, activeAsset, tradeAmountUnits, "SOFT_TIMEOUT_PROFIT");
      return createInitialPositionState();
    }
  } else if (elapsedTimeMs >= MAIN_TIMEOUT_MS) {
    const mainTimeoutPrice = entryPrice * 1.0100; // +1.00%
    if (currentPrice >= mainTimeoutPrice) {
      console.log(`\n⏳ [MAIN TIMEOUT EXIT] Held ${hoursHeld}h (Past 4h Main Timeout). Exiting at +1.00%.`);
      await executeSell(exchange, activeAsset, tradeAmountUnits, "MAIN_TIMEOUT_PROFIT");
      return createInitialPositionState();
    }
  }

  // Return updated state with new trailing levels
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
