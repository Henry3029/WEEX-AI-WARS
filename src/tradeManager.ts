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

  // 3. REAL-WORLD TIME-BASED TIMEOUT (WITH GUARDRAILS)
  if (elapsedTimeMs >= CONFIG.MAX_HOLD_TIME_MS) {
    // Guardrail: Only exit on time if price is stagnant/flat (-0.5% to +1.0%).
    // If it's climbing strong (+1.8%), let it ride toward TP!
    const isStagnant = priceChangePct >= -0.5 && priceChangePct <= 1.0;

    if (isStagnant) {
      console.log(
        `\n⏳ [TIME TIMEOUT] Trade held for ${hoursHeld} hours with minimal movement (${priceChangePct.toFixed(2)}%). ` +
        `Closing position to release capital.`
      );
      await executeSell(exchange, activeAsset, tradeAmountUnits, "TIME_TIMEOUT_STAGNANT");
      return createInitialPositionState();
    } else {
      console.log(`\n⚠️ [TIMEOUT PASSED] 6h elapsed, but trade is trending (${priceChangePct.toFixed(2)}%). Staying in position.`);
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