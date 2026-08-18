import { PositionState } from './types';
import { CONFIG } from './config';
import { logAIDecision } from './utils/logger';

export interface ExtendedPositionState extends PositionState {
  hasTakenPartialProfit?: boolean;
  highestPriceSinceEntry?: number;
  lastExitReason?: string | null;
  tierTargetLocked?: boolean; 
  lockedProfitPct?: number; // Tracks current step-up locked profit %
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
    tierTargetLocked = false,
    lockedProfitPct = 0
  } = position;

  const cleanAsset = activeAsset.split(':')[0];
  const elapsedTimeMs = Date.now() - entryTime;
  const timeHeldFormatted = formatDuration(elapsedTimeMs);
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;

  const currentHighestPrice = Math.max(highestPriceSinceEntry, currentPrice, entryPrice);
  const peakPriceChangePct = ((currentHighestPrice - entryPrice) / entryPrice) * 100;

  const STAGNANT_TIMEOUT_MS = CONFIG.STAGNANT_TIMEOUT_MS || (24 * 60 * 60 * 1000); // 24 Hours

  // Status Logging
  console.log(
    `[TRADE ACTIVE: ${cleanAsset}] Price: $${currentPrice} | Peak: $${currentHighestPrice.toFixed(4)} (+${peakPriceChangePct.toFixed(2)}%) | ` +
    `SL/TS: $${stopLossPrice.toFixed(4)} | PnL: ${priceChangePct.toFixed(2)}% | Partial TP: ${hasTakenPartialProfit} | ` +
    `Held: ${timeHeldFormatted} | (Rem to 24h Cutoff: ${formatDuration(STAGNANT_TIMEOUT_MS - elapsedTimeMs)})`
  );

  let updatedStopLoss = stopLossPrice;
  let updatedTierTargetLocked = tierTargetLocked;
  let updatedLockedProfitPct = lockedProfitPct;

  // -------------------------------------------------------------
  // 1. 24-HOUR STAGNANT ASSET CUTOFF (EVICT UNPRODUCTIVE TRADES)
  // -------------------------------------------------------------
  if (elapsedTimeMs >= STAGNANT_TIMEOUT_MS && peakPriceChangePct < 0.20) {
    console.log(
      `\n⏱️ [24H STAGNANT CUTOFF] Trade held for ${timeHeldFormatted} without touching +0.20% peak. ` +
      `Exiting at $${currentPrice} (${priceChangePct.toFixed(2)}%) to liberate capital for better opportunities.`
    );
    
    await executeSell(exchange, activeAsset, tradeAmountUnits, "24H_STAGNANT_TIMEOUT");
    const resetState = createInitialPositionState();
    resetState.lastExitReason = "24H_STAGNANT_TIMEOUT";
    return resetState;
  }

  // -------------------------------------------------------------
  // 2. DYNAMIC STEP-UP PROFIT LOCKS (STARTS AT +0.50% PEAK / ACTIVE ANYTIME)
  // -------------------------------------------------------------
  if (!hasTakenPartialProfit && peakPriceChangePct >= 0.50) {
    // Continuous Step-Up Locks:
    // Peak hit +0.50% -> Lock SL at +0.30%
    // Peak hit +1.00% -> Lock SL at +0.80%
    // Peak hit +1.50% -> Lock SL at +1.30%
    const stepMultiplier = Math.floor((peakPriceChangePct - 0.50) / 0.50);
    const targetLockPct = 0.30 + (stepMultiplier * 0.50);

    if (targetLockPct > updatedLockedProfitPct) {
      const calculatedSL = entryPrice * (1 + targetLockPct / 100);
      
      // Safety Check: Only apply if calculated SL > current SL AND current live price > calculated SL
      if (calculatedSL > updatedStopLoss && currentPrice > calculatedSL) {
        updatedStopLoss = calculatedSL;
        updatedLockedProfitPct = targetLockPct;
        updatedTierTargetLocked = true;
        console.log(
          `\n🔒 [ANYTIME STEP-UP LOCK] Peak hit +${peakPriceChangePct.toFixed(2)}%! ` +
          `Locking SL at +${targetLockPct.toFixed(2)}% ($${calculatedSL.toFixed(4)}) with 0.20% buffer.`
        );
      }
    }
  }

  // -------------------------------------------------------------
  // 3. PARTIAL TAKE PROFIT (+2.00% Move -> Sell 50% & Enable Trailing)
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
  // 4. DYNAMIC TRAILING STOP ADJUSTMENT (After Partial TP)
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
  // 5. STOP LOSS / TRAILING STOP / LOCKED PROFIT EXECUTION
  // -------------------------------------------------------------
  if (currentPrice <= updatedStopLoss) {
    let slReason = "HARD_STOP_LOSS_HIT";
    if (hasTakenPartialProfit) {
      slReason = "TRAILING_STOP_HIT";
    } else if (updatedTierTargetLocked) {
      slReason = `STEP_UP_LOCKED_PROFIT_HIT_${updatedLockedProfitPct.toFixed(2).replace('.', '_')}_PCT`;
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
