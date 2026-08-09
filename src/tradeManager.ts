import { PositionState } from './types';
import { CONFIG } from './config';
import { logAIDecision } from './utils/logger';

export function createInitialPositionState(): PositionState {
  return {
    isHoldingPosition: false,
    activeAsset: '',
    entryPrice: 0,
    takeProfitPrice: 0,
    stopLossPrice: 0,
    tradeAmountUnits: 0,
    entryTime: 0
  };
}

export async function processActivePosition(
  exchange: any,
  position: PositionState,
  currentPrice: number
): Promise<PositionState> {
  const { activeAsset, takeProfitPrice, stopLossPrice, tradeAmountUnits, entryTime, entryPrice } = position;
  const elapsedTimeMs = Date.now() - entryTime;
  const hoursHeld = (elapsedTimeMs / (1000 * 60 * 60)).toFixed(2);
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;
  const leveragePnL = priceChangePct * 20; // ROE for 20x Leverage

  console.log(
    `[TRADE ACTIVE: ${activeAsset}] Current: $${currentPrice} | TP: $${takeProfitPrice.toFixed(4)} | ` +
    `SL: $${stopLossPrice.toFixed(4)} | PnL: ${priceChangePct.toFixed(2)}% (ROE: ${leveragePnL.toFixed(1)}%) | Held: ${hoursHeld}h`
  );

  // -------------------------------------------------------------
  // ALWAYS ACTIVE: IMMEDIATE HARD TARGETS
  // -------------------------------------------------------------

  // 1. HARD TAKE PROFIT
  if (currentPrice >= takeProfitPrice) {
    console.log(`\n💰💰💰 [TAKE PROFIT HIT] Target reached for ${activeAsset} at $${currentPrice}!`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, "TAKE_PROFIT_HIT");
    return createInitialPositionState();
  }

  // 2. HARD STOP LOSS (-1.00% Safeguard)
  if (currentPrice <= stopLossPrice) {
    console.log(`\n🛡️🛡️🛡️ [STOP LOSS HIT] Safeguarding funds. Closing ${activeAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, "STOP_LOSS_HIT");
    return createInitialPositionState();
  }

  // -------------------------------------------------------------
  // TIME-BASED CASCADING EXITS
  // -------------------------------------------------------------
  const MAIN_TIMEOUT_MS = CONFIG.MAX_HOLD_TIME_MS; // e.g. 4 hours
  const MEDIUM_TIMEOUT_MS = CONFIG.MEDIUM_HOLD_TIME_MS || (MAIN_TIMEOUT_MS + (3 * 60 * 60 * 1000)); // 4h + 3h = 7h

  // TIER 3: MEDIUM TIMEOUT PASSED (7+ Hours) -> INFINITE SOFT EXIT HOLD
  if (elapsedTimeMs >= MEDIUM_TIMEOUT_MS) {
    const softExitPrice = entryPrice * 1.0020; // +0.20% Soft Profit Target

    if (currentPrice >= softExitPrice) {
      console.log(
        `\n⏳ [SOFT EXIT / FINAL VERDICT] Held for ${hoursHeld}h (Past Medium Timeout). ` +
        `Price reached +0.20% target ($${currentPrice}). Exiting in profit!`
      );
      await executeSell(exchange, activeAsset, tradeAmountUnits, "SOFT_TIMEOUT_PROFIT");
      return createInitialPositionState();
    } else {
      console.log(
        `⏳ [INFINITE HOLD / SOFT WAITING] Held ${hoursHeld}h (Past Medium Timeout). ` +
        `Holding indefinitely until price hits +0.20% ($${softExitPrice.toFixed(4)}) or Stop Loss...`
      );
    }
  } 
  // TIER 2: MAIN TIMEOUT PASSED (4 to 7 Hours) -> LOOKING FOR +1.00%
  else if (elapsedTimeMs >= MAIN_TIMEOUT_MS) {
    const mainTimeoutPrice = entryPrice * 1.0100; // +1.00% Target

    if (currentPrice >= mainTimeoutPrice) {
      console.log(
        `\n⏳ [MAIN TIMEOUT EXIT] Held for ${hoursHeld}h and reached +1.00% ($${currentPrice}). Closing to release capital.`
      );
      await executeSell(exchange, activeAsset, tradeAmountUnits, "MAIN_TIMEOUT_PROFIT");
      return createInitialPositionState();
    } else {
      console.log(
        `⏳ [MEDIUM TIMEOUT ACTIVE] Held ${hoursHeld}h. Waiting for +1.00% ($${mainTimeoutPrice.toFixed(4)}) before Medium Timeout...`
      );
    }
  }

  return position; // Keep holding position unchanged
}

async function executeSell(exchange: any, asset: string, units: number, reason: string) {
  if (!CONFIG.DRY_RUN) {
    try {
      // ✅ Forces WEEX to ONLY close your active Long position
      await exchange.createMarketSellOrder(asset, units, {
        'reduceOnly': true,      // Tells exchange to only reduce/close open trade
        'positionSide': 'LONG'   // Targets active Long position
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
