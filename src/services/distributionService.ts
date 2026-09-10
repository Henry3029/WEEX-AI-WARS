import mongoose from 'mongoose';
import User from '@/models/User';
import EngineAllocation from '@/models/EngineAllocation';
import Transaction from '@/models/Transaction';
import { emitSystemLog } from '../../AI'; // Importing WebSocket logger

export interface TradeExitResult {
  engineName: 'MAJOR_ENGINE' | 'ALT_ENGINE' | 'MEME_ENGINE';
  asset: string;
  entryPrice: number;
  exitPrice: number;
  pnlPercentage: number; // e.g., 0.02 for +2.00%
  platformFeeRate?: number; // e.g., 0.20 for 20% performance fee
}

export async function processTradeProfitDistribution(tradeResult: TradeExitResult) {
  const { engineName, asset, pnlPercentage, platformFeeRate = 0.20 } = tradeResult;

  // 1. Skip distribution if trade ended in a loss or breakeven
  if (pnlPercentage <= 0) {
    console.log(`[Distribution] ${engineName} closed with PnL ${pnlPercentage}%. No profit fee applied.`);
    return;
  }

  // Start a Mongoose session for atomic ACID transactions
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // 2. Fetch all active allocations for this specific engine (No need to populate if using userId)
    const activeAllocations = await EngineAllocation.find({
      engineName,
      status: 'ACTIVE',
      allocatedUsdt: { $gt: 0 }
    }).session(session);

    if (activeAllocations.length === 0) {
      console.log(`[Distribution] No active user allocations found for ${engineName}.`);
      await session.abortTransaction();
      session.endSession();
      return;
    }

    let totalPlatformFeesCollected = 0;

    // 3. Update balances and record transactions atomically
    for (const allocation of activeAllocations) {
      // Calculate user's proportional gross profit
      const userGrossProfit = allocation.allocatedUsdt * pnlPercentage;
      
      // Calculate platform performance fee (20%) and net user profit (80%)
      const platformFee = userGrossProfit * platformFeeRate;
      const userNetProfit = userGrossProfit - platformFee;

      totalPlatformFeesCollected += platformFee;

      // Credit user's free balance with net profit ($inc atomically increments the balance)
      await User.findByIdAndUpdate(
        allocation.userId,
        { $inc: { freeUsdtBalance: userNetProfit } },
        { session, new: true }
      );

      // Record transaction logs for auditing
      await Transaction.create(
        [
          {
            userId: allocation.userId,
            type: 'PROFIT_PAYOUT',
            amount: userNetProfit,
            status: 'COMPLETED',
            reference: `${engineName}:${asset}:NET_GAIN`
          }
        ],
        { session }
      );
    }

    // Commit all changes in this batch
    await session.commitTransaction();
    session.endSession();

    console.log(
      `[Distribution] Successfully distributed net profits for ${engineName}. Platform Fee Collected: $${totalPlatformFeesCollected.toFixed(2)} USDT`
    );

    // 4. Safely broadcast distribution log to WebSocket clients
    try {
      emitSystemLog(
        engineName, 
        'TAKE_PROFIT', 
        `Trade closed on ${asset} (+${(pnlPercentage * 100).toFixed(2)}%). Net profits distributed to active pool holders!`
      );
    } catch (wsErr) {
      console.warn('[Distribution] WebSocket log broadcast skipped:', wsErr);
    }

  } catch (error: any) {
    // Abort transaction if any single update or insert fails
    await session.abortTransaction();
    session.endSession();
    console.error(`[Distribution Error] Failed to process payouts for ${engineName}:`, error);
  }
}