"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateStrategy = evaluateStrategy;
exports.calculateDynamicAmount = calculateDynamicAmount;
const technicalindicators_1 = require("technicalindicators");
function evaluateStrategy(closePrices, asset) {
    if (closePrices.length < 20) {
        return { isSignal: false, fastEma: 0, slowEma: 0, rsi: 0, reason: 'Insufficient price candles' };
    }
    const emaFastArray = technicalindicators_1.EMA.calculate({ period: 5, values: closePrices });
    const emaSlowArray = technicalindicators_1.EMA.calculate({ period: 13, values: closePrices });
    const rsiArray = technicalindicators_1.RSI.calculate({ period: 14, values: closePrices });
    const currentEmaFast = emaFastArray[emaFastArray.length - 1];
    const currentEmaSlow = emaSlowArray[emaSlowArray.length - 1];
    const prevEmaFast = emaFastArray[emaFastArray.length - 2];
    const prevEmaSlow = emaSlowArray[emaSlowArray.length - 2];
    const currentRSI = rsiArray[rsiArray.length - 1];
    const isEmaCrossover = (prevEmaFast <= prevEmaSlow) && (currentEmaFast > currentEmaSlow);
    const isNotOverbought = currentRSI < 65;
    const isSignal = isEmaCrossover && isNotOverbought;
    const reason = isSignal
        ? `[${asset}] Fast EMA (5) crossed above Slow EMA (13). RSI is at ${currentRSI.toFixed(1)}.`
        : 'No crossover detected or market overbought.';
    return {
        isSignal,
        fastEma: currentEmaFast,
        slowEma: currentEmaSlow,
        rsi: currentRSI,
        reason
    };
}
function calculateDynamicAmount(exchange, asset, currentPrice, targetMarginUSD, leverage) {
    const totalBuyingPower = targetMarginUSD * leverage;
    const rawTokenAmount = totalBuyingPower / currentPrice;
    const precisionAmountStr = exchange.amountToPrecision(asset, rawTokenAmount);
    return parseFloat(precisionAmountStr);
}
