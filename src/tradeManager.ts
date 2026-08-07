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

  // 1. CHECK TAKE PROFIT (+0.20% Price Move.)
  if (currentPrice >= takeProfitPrice) {
    console.log(`\n💰💰💰 [TAKE PROFIT HIT] Target reached for ${activeAsset} at $${currentPrice} (+0.20% Price Gain)!`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, "TAKE_PROFIT_HIT");
    return createInitialPositionState();
  }

  // 2. CHECK STOP LOSS (-1.00% Price Move)
  if (currentPrice <= stopLossPrice) {
    console.log(`\n🛡️🛡️🛡️ [STOP LOSS HIT] Safeguarding funds. Closing ${activeAsset} at $${currentPrice}.`);
    await executeSell(exchange, activeAsset, tradeAmountUnits, "STOP_LOSS_HIT");
    return createInitialPositionState();
  }

  // 3. SOFT TIMEOUT EXIT (AFTER 3 HOURS pass & Price reaches +0.15%)
  if (elapsedTimeMs >= CONFIG.MAX_HOLD_TIME_MS) {
    const minSoftExitPrice = entryPrice * 1.0015; // +0.15% price target (covers fees)

    if (currentPrice >= minSoftExitPrice) {
      console.log(
        `\n⏳ [SOFT TIMEOUT EXIT] Held for ${hoursHeld}h and price reached +${priceChangePct.toFixed(2)}%. ` +
        `Closing position in profit to release capital.`
      );
      await executeSell(exchange, activeAsset, tradeAmountUnits, "SOFT_TIMEOUT_PROFIT");
      return createInitialPositionState();
    } else {
      console.log(
        `⏳ [SOFT EXIT WAITING] Held ${hoursHeld}h (Price: ${priceChangePct.toFixed(2)}%). ` +
        `Waiting for price to reach +0.15% ($${minSoftExitPrice.toFixed(4)}) before closing...`
      );
    }
  }

  return position; // Keep holding position unchanged
}

async function executeSell(exchange: any, asset: string, units: number, reason: string) {
  if (!CONFIG.DRY_RUN) {
    try {
      // ✅ New Code (Forces WEEX to ONLY close your existing Long position)
await exchange.createMarketSellOrder(asset, units, {
  'reduceOnly': true,      // Tells the exchange to only reduce/close the active trade
  'positionSide': 'LONG'   // Targets your active Long position
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
