import { PositionState } from './types';
import { CONFIG } from './config';
import { logAIDecision } from './utils/logger';

export interface ExtendedPositionState extends PositionState {
  hasTakenPartialProfit?: boolean;
  highestPriceSinceEntry?: number;
  lastExitReason?: string | null;
  softTargetLocked?: boolean; 
  tierTargetLocked?: boolean; 
  lockedProfitPct?: number; // Tracks the current step-up locked profit %
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
    tierTargetLocked: false,
    lockedProfitPct: 0
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
    tierTargetLocked = false,
    lockedProfitPct = 0
  } = position;

  const cleanAsset = activeAsset.split(':')[0];
  const elapsedTimeMs = Date.now() - entryTime;
  const timeHeldFormatted = formatDuration(elapsedTimeMs);
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  const currentHighestPrice = Math.max(highestPriceSinceEntry, currentPrice, entryPrice);
  const peakPriceChangePct = ((currentHighestPrice - entryPrice) / entryPrice) * 100;

  const MAIN_TIMEOUT_MS = CONFIG.MAX_HOLD_TIME_MS; 
  const MEDIUM_TIMEOUT_MS = CONFIG.MEDIUM_HOLD_TIME_MS || (MAIN_TIMEOUT_MS + (1 * 60 * 60 * 1000)); 

  // Status Logging
  let phaseLog = '';
  if (elapsedTimeMs < MAIN_TIMEOUT_MS) {
    phaseLog = `Pre-Timeout Phase (Rem: ${formatDuration(MAIN_TIMEOUT_MS - elapsedTimeMs)})`;
  } else if (elapsedTimeMs < MEDIUM_TIMEOUT_MS) {
    phaseLog = `Main Timeout Step-Up Active (Rem: ${formatDuration(MEDIUM_TIMEOUT_MS - elapsedTimeMs)})`;
  } else {
    phaseLog = `Standalone Soft Step-Up Active (Post-Timeout)`;
  }

  console.log(
    `[TRADE ACTIVE: ${cleanAsset}] Price: $${currentPrice} | Peak: $${currentHighestPrice.toFixed(4)} (+${peakPriceChangePct.toFixed(2)}%) | ` +
    `SL/TS: $${stopLossPrice.toFixed(4)} | PnL: ${priceChangePct.toFixed(2)}% | Partial TP: ${hasTakenPartialProfit} | ` +
    `Held: ${timeHeldFormatted} | (${phaseLog})`
  );

  let updatedStopLoss = stopLossPrice;
  let updatedSoftTargetLocked = softTargetLocked;
  let updatedTierTargetLocked = tierTargetLocked;
  let updatedLockedProfitPct = lockedProfitPct;

  // -------------------------------------------------------------
  // 1. STEP-UP PROFIT LOCKING (Main & Medium Timeout Windows)
  // -------------------------------------------------------------
  const isPastMainTimeout = elapsedTimeMs >= MAIN_TIMEOUT_MS;
  const isPostMediumTimeout = elapsedTimeMs >= MEDIUM_TIMEOUT_MS;

  if (!hasTakenPartialProfit) {
    
    // A. Main Timeout Window Step-Up Locks (Between Main Timeout and Medium Timeout)
    if (isPastMainTimeout && !isPostMediumTimeout) {
      // Calculate dynamic step-up threshold based on highest peak price achieved
      // Base trigger starts at +1.00%, locking SL at +0.80% (80% profit lock / 0.20% buffer)
      if (peakPriceChangePct >= 1.00) {
        // Steps: +1.00% -> lock +0.80%, +1.50% -> lock +1.30%, +2.00% -> lock +1.80%, etc.
        const stepMultiplier = Math.floor((peakPriceChangePct - 1.00) / 0.50);
        const targetLockPct = 0.80 + (stepMultiplier * 0.50);

        if (targetLockPct > updatedLockedProfitPct) {
          const calculatedSL = entryPrice * (1 + targetLockPct / 100);
          if (calculatedSL > updatedStopLoss) {
            updatedStopLoss = calculatedSL;
            updatedLockedProfitPct = targetLockPct;
            updatedTierTargetLocked = true;
            console.log(
              `\n🔒 [MAIN TIMEOUT STEP-UP LOCK] Peak hit +${peakPriceChangePct.toFixed(2)}%! ` +
              `Locking SL at +${targetLockPct.toFixed(2)}% ($${calculatedSL.toFixed(4)}) with 0.20% buffer.`
            );
          }
        }
      }
    }

    // B. Standalone Soft Exit Window Step-Up Locks (Post Medium Timeout)
    else if (isPostMediumTimeout) {
      // Step 1: Base soft protection locks at +0.20%
      if (peakPriceChangePct >= 0.20 && peakPriceChangePct < 0.50 && !softTargetLocked) {
        const lock020Price = entryPrice * 1.0020;
        if (lock020Price > updatedStopLoss) {
          updatedStopLoss = lock020Price;
          updatedSoftTargetLocked = true;
          updatedLockedProfitPct = 0.20;
          console.log(`\n🔒 [POST-TIMEOUT SOFT LOCK] Price hit +${peakPriceChangePct.toFixed(2)}%! Locking SL at +0.20% ($${lock020Price.toFixed(4)}).`);
        }
      } 
      // Step 2: Step-Up locks starting from +0.50% peak (Locking +0.30% first, then stepping up every +0.50%)
      else if (peakPriceChangePct >= 0.50) {
        const stepMultiplier = Math.floor((peakPriceChangePct - 0.50) / 0.50);
        const targetLockPct = 0.30 + (stepMultiplier * 0.50);

        if (targetLockPct > updatedLockedProfitPct) {
          const calculatedSL = entryPrice * (1 + targetLockPct / 100);
          if (calculatedSL > updatedStopLoss) {
            updatedStopLoss = calculatedSL;
            updatedLockedProfitPct = targetLockPct;
            updatedTierTargetLocked = true;
            console.log(
              `\n🔒 [POST-TIMEOUT STEP-UP LOCK] Peak hit +${peakPriceChangePct.toFixed(2)}%! ` +
              `Locking SL at +${targetLockPct.toFixed(2)}% ($${calculatedSL.toFixed(4)}) with 0.20% buffer.`
            );
          }
        }
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
      slReason = `STEP_UP_LOCKED_PROFIT_HIT_${updatedLockedProfitPct.toFixed(2).replace('.', '_')}_PCT`;
    } else if (softTargetLocked) {
      slReason = "SOFT_PROTECTION_020_HIT";
    }

    console.log(`\n🛡️🛡️🛡️ [${slReason}] Closing position on ${cleanAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, slReason);
    
    const resetState = createInitialPositionState();
    resetState.lastExitReason = slReason;
    return resetState;
  }

  return {
    ...position,
    stopLossPrice: updatedStopLoss,
    highestPriceSinceEntry: currentHighestPrice,
    softTargetLocked: updatedSoftTargetLocked,
    tierTargetLocked: updatedTierTargetLocked,
    lockedProfitPct: updatedLockedProfitPct
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
