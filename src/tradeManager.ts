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

  console.log(
    `[TRADE ACTIVE: ${activeAsset}] Current: $${currentPrice} | TP: $${takeProfitPrice.toFixed(2)} | ` +
    `SL: $${stopLossPrice.toFixed(2)} | PnL: ${priceChangePct.toFixed(2)}% | Held: ${hoursHeld}h`
  );

  // 1. CHECK TAKE PROFIT
  if (currentPrice >= takeProfitPrice) {
    console.log(`\n💰💰💰 [TAKE PROFIT HIT] Closing position for ${activeAsset} at $${currentPrice}!`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, "TAKE_PROFIT_HIT");
    return createInitialPositionState();
  }

  // 2. CHECK STOP LOSS
  if (currentPrice <= stopLossPrice) {
    console.log(`\n🛡️🛡️🛡️ [STOP LOSS HIT] Safeguarding funds. Closing ${activeAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, "STOP_LOSS_HIT");
    return createInitialPositionState();
  }

  // 3. REAL-WORLD TIME-BASED TIMEOUT (WITH HARD CAP GUARDRAIL)
  const HARD_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours absolute max limit

  if (elapsedTimeMs >= CONFIG.MAX_HOLD_TIME_MS) {
    const isStagnant = priceChangePct >= -0.5 && priceChangePct <= 1.0;
    const reachedHardCap = elapsedTimeMs >= HARD_TIMEOUT_MS;

    // A. Exit if price is flat/stagnant after 6 hours
    if (isStagnant) {
      console.log(
        `\n⏳ [TIME TIMEOUT] Trade held for ${hoursHeld}h with stagnant movement (${priceChangePct.toFixed(2)}%). ` +
        `Closing position to release capital.`
      );
      await executeSell(exchange, activeAsset, tradeAmountUnits, "TIME_TIMEOUT_STAGNANT");
      return createInitialPositionState();
    } 
    // B. Hard Exit if 8 hours total pass (prevents infinite hanging near TP)
    else if (reachedHardCap) {
      console.log(
        `\n🛑 [HARD TIMEOUT] Reached maximum 8-hour cap at ${priceChangePct.toFixed(2)}%. ` +
        `Exiting position at market price.`
      );
      await executeSell(exchange, activeAsset, tradeAmountUnits, "HARD_TIMEOUT_REACHED");
      return createInitialPositionState();
    } 
    // C. Price is > +1.0% and under 8 hours -> Keep holding for TP!
    else {
      console.log(
        `⚠️ [TIMEOUT EXTENDED] Trade held ${hoursHeld}h, but price is trending (+${priceChangePct.toFixed(2)}%). ` +
        `Allowing extended hold up to 8h cap.`
      );
    }
  }

  return position; // Keep holding position unchanged
}

async function executeSell(exchange: any, asset: string, units: number, reason: string) {
  if (!CONFIG.DRY_RUN) {
    try {
      await exchange.createMarketSellOrder(asset, units);
      console.log(`✅ [LIVE SELL SUCCESS] Exit Reason: ${reason}`);
    } catch (exitError: any) {
      console.error(`❌ Critical: Failed to execute sell order: ${exitError.message}`);
    }
  } else {
    console.log(`🧪 [DRY_RUN] Simulated sell of ${units} units of ${asset}. Reason: ${reason}`);
  }

  logAIDecision(reason, `Exited ${asset} position.`, { asset, units, mode: CONFIG.DRY_RUN ? 'DRY_RUN' : 'LIVE' });
}