import { PositionState } from './types';
import { CONFIG } from './config';
import { logAIDecision } from './utils/logger';

export interface ExtendedPositionState extends PositionState {
  hasTakenPartialProfit?: boolean;
  highestPriceSinceEntry?: number;
  lastExitReason?: string | null;
  softTargetLocked?: boolean; // Tracks +0.20% standalone lock
  tierTargetLocked?: boolean; // Tracks +0.50% standalone lock
}

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
    highestPriceSinceEntry: 0,
    lastExitReason: null,
    softTargetLocked: false,
    tierTargetLocked: false
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
    highestPriceSinceEntry = 0,
    softTargetLocked = false,
    tierTargetLocked = false
  } = position;

  const cleanAsset = activeAsset.split(':')[0];
  const elapsedTimeMs = Date.now() - entryTime;
  const timeHeldFormatted = formatDuration(elapsedTimeMs);
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  const currentHighestPrice = Math.max(highestPriceSinceEntry, currentPrice, entryPrice);

  const MAIN_TIMEOUT_MS = CONFIG.MAX_HOLD_TIME_MS; 
  const MEDIUM_TIMEOUT_MS = CONFIG.MEDIUM_HOLD_TIME_MS || (MAIN_TIMEOUT_MS + (3 * 60 * 60 * 1000)); // 7 Hours

  // Status Log
  let phaseLog = '';
  if (elapsedTimeMs < MAIN_TIMEOUT_MS) {
    phaseLog = `Main Target Phase (Rem: ${formatDuration(MAIN_TIMEOUT_MS - elapsedTimeMs)})`;
  } else if (elapsedTimeMs < MEDIUM_TIMEOUT_MS) {
    phaseLog = `Medium Target Phase (Rem: ${formatDuration(MEDIUM_TIMEOUT_MS - elapsedTimeMs)})`;
  } else {
    phaseLog = `STANDALONE SOFT PHASE ACTIVE (Post-7h)`;
  }

  console.log(
    `[TRADE ACTIVE: ${cleanAsset}] Price: $${currentPrice} | Peak: $${currentHighestPrice.toFixed(4)} | ` +
    `SL/TS: $${stopLossPrice.toFixed(4)} | PnL: ${priceChangePct.toFixed(2)}% | Partial TP: ${hasTakenPartialProfit} | ` +
    `Held: ${timeHeldFormatted} | (${phaseLog})`
  );

  let updatedStopLoss = stopLossPrice;
  let updatedSoftTargetLocked = softTargetLocked;
  let updatedTierTargetLocked = tierTargetLocked;

  // -------------------------------------------------------------
  // 1. STANDALONE SOFT TARGET LOCKS (STRICTLY AFTER 7 HOURS)
  // -------------------------------------------------------------
  const isPostSevenHours = elapsedTimeMs >= MEDIUM_TIMEOUT_MS;

  if (isPostSevenHours && !hasTakenPartialProfit) {
    
    // Tier 2: Price hits +0.50% after 7 hours -> Upgrade SL Lock to +0.50%
    if (priceChangePct >= 0.50 && !tierTargetLocked) {
      const lock050Price = entryPrice * 1.0050;
      if (lock050Price > updatedStopLoss) {
        updatedStopLoss = lock050Price;
        updatedTierTargetLocked = true;
        console.log(`\n🔒 [POST-7H STANDALONE LOCK: +0.50%] Price hit +${priceChangePct.toFixed(2)}%! Locking SL at +0.50% ($${lock050Price.toFixed(4)}).`);
      }
    } 
    // Tier 1: Price hits +0.20% after 7 hours -> Set SL Lock at +0.20%
    else if (priceChangePct >= 0.20 && !softTargetLocked && !tierTargetLocked) {
      const lock020Price = entryPrice * 1.0020;
      if (lock020Price > updatedStopLoss) {
        updatedStopLoss = lock020Price;
        updatedSoftTargetLocked = true;
        console.log(`\n🔒 [POST-7H STANDALONE LOCK: +0.20%] Price hit +${priceChangePct.toFixed(2)}%! Locking SL at +0.20% ($${lock020Price.toFixed(4)}).`);
      }
    }
  }

  // -------------------------------------------------------------
  // 2. PARTIAL TAKE PROFIT (+2.00% Move -> Sell 50% & Enable Trailing)
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
      highestPriceSinceEntry: currentPrice,
      lastExitReason: "PARTIAL_TP_50_PERCENT"
    };
  }

  // -------------------------------------------------------------
  // 3. DYNAMIC TRAILING STOP ADJUSTMENT (After Partial TP)
  // -------------------------------------------------------------
  if (hasTakenPartialProfit) {
    const TRAILING_DISTANCE_PCT = 0.0050; // 0.50% Trailing Distance
    const calculatedTrailingStop = currentHighestPrice * (1 - TRAILING_DISTANCE_PCT);

    if (calculatedTrailingStop > updatedStopLoss) {
      updatedStopLoss = calculatedTrailingStop;
      console.log(
        `📈 [TRAILING STOP UPDATED] Peak: $${currentHighestPrice.toFixed(4)} | ` +
        `New Trailing SL: $${updatedStopLoss.toFixed(4)}`
      );
    }
  }

  // -------------------------------------------------------------
  // 4. STOP LOSS / TRAILING STOP / LOCKED PROFIT EXECUTION
  // -------------------------------------------------------------
  if (currentPrice <= updatedStopLoss) {
    let slReason = "HARD_STOP_LOSS_HIT";
    if (hasTakenPartialProfit) {
      slReason = "TRAILING_STOP_HIT";
    } else if (tierTargetLocked) {
      slReason = "POST_7H_PROTECTION_050_HIT";
    } else if (softTargetLocked) {
      slReason = "POST_7H_PROTECTION_020_HIT";
    }

    console.log(`\n🛡️🛡️🛡️ [${slReason}] Closing position on ${cleanAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, slReason);
    
    const resetState = createInitialPositionState();
    resetState.lastExitReason = slReason;
    return resetState;
  }

  // -------------------------------------------------------------
  // 5. MAIN TIMEOUT EXITS (Runs STRICTLY within the first 7 Hours)
  // -------------------------------------------------------------
  if (!isPostSevenHours) {
    if (elapsedTimeMs >= MAIN_TIMEOUT_MS && elapsedTimeMs < MEDIUM_TIMEOUT_MS) {
      const mainTimeoutPrice = entryPrice * 1.0100; // +1.00%
      if (currentPrice >= mainTimeoutPrice) {
        console.log(`\n⏳ [MAIN TIMEOUT EXIT] Held ${timeHeldFormatted} (Past 4h Main Timeout). Exiting at +1.00%.`);
        await executeSell(exchange, activeAsset, tradeAmountUnits, "MAIN_TIMEOUT_PROFIT");
        const resetState = createInitialPositionState();
        resetState.lastExitReason = "MAIN_TIMEOUT_PROFIT";
        return resetState;
      }
    }
  }

  return {
    ...position,
    stopLossPrice: updatedStopLoss,
    highestPriceSinceEntry: currentHighestPrice,
    softTargetLocked: updatedSoftTargetLocked,
    tierTargetLocked: updatedTierTargetLocked
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
