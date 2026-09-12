import express, { Request, Response, NextFunction } from 'express';
import EngineAllocation from '@/models/EngineAllocation';
import { engineStatesStore, systemLogsStore } from '../../AI';
import { connectToDatabase } from '@/lib/mongodb';
import jwt from 'jsonwebtoken';
import User from '@/models/User';
import mongoose from 'mongoose';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_jwt_secret';

// GET ACTIVE ENGINE STATES & ALLOCATIONS
router.get('/status', async (req: Request, res: Response) => {
  try {
    await connectToDatabase();

    // 1. Extract optional userId
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userId: string | null = null;

    if (token) {
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch (e) {}
    }

    // 2. Fetch allocations for logged-in user
    let userAllocations: Record<string, number> = {};
    if (userId) {
      const allocations = await EngineAllocation.find({ userId, status: 'ACTIVE' });
      allocations.forEach((alloc: any) => {
        userAllocations[alloc.engineName] = alloc.allocatedUsdt;
      });
    }

    // 3. Get latest logs from memory store
    const formattedLogs = systemLogsStore.slice(0, 20);

    // 4. Build live engine array reading from memory store
    const engines = [
      {
        id: 'MAJOR_ENGINE',
        name: 'Major Assets Engine',
        focusAssets: ['BTC/USDT', 'ETH/USDT', 'BNB/USDT'],
        currentAsset: engineStatesStore['MAJOR_ENGINE']?.currentAsset || 'BTC/USDT',
        status: engineStatesStore['MAJOR_ENGINE']?.status || 'HUNTING',
        pnlPercentage: engineStatesStore['MAJOR_ENGINE']?.pnlPercentage || 0.00,
        currentPrice: engineStatesStore['MAJOR_ENGINE']?.currentPrice || 0.00,
        allocatedCapital: userAllocations['MAJOR_ENGINE'] || 0
      },
      {
        id: 'ALT_ENGINE',
        name: 'Altcoin Engine',
        focusAssets: ['DOGE/USDT', 'XRP/USDT', 'AVAX/USDT', 'ZEC/USDT'],
        currentAsset: engineStatesStore['ALT_ENGINE']?.currentAsset || 'DOGE/USDT',
        status: engineStatesStore['ALT_ENGINE']?.status || 'HUNTING',
        pnlPercentage: engineStatesStore['ALT_ENGINE']?.pnlPercentage || 0.00,
        currentPrice: engineStatesStore['ALT_ENGINE']?.currentPrice || 0.00,
        allocatedCapital: userAllocations['ALT_ENGINE'] || 0
      },
      {
        id: 'MEME_ENGINE',
        name: 'Meme/High-Vol Engine',
        focusAssets: ['BTW/USDT'],
        currentAsset: engineStatesStore['MEME_ENGINE']?.currentAsset || 'BTW/USDT',
        status: engineStatesStore['MEME_ENGINE']?.status || 'HUNTING',
        pnlPercentage: engineStatesStore['MEME_ENGINE']?.pnlPercentage || 0.00,
        currentPrice: engineStatesStore['MEME_ENGINE']?.currentPrice || 0.00,
        allocatedCapital: userAllocations['MEME_ENGINE'] || 0
      }
    ];

    res.json({ engines, logs: formattedLogs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// 4. ALLOCATE CAPITAL TO ENGINE (Atomic Mongoose Transaction)
// -------------------------------------------------------------
router.post('/allocate', async (req: Request, res: Response) => {
  await connectToDatabase();

  if (!req.body.amountUsdt || req.body.amountUsdt <= 0) {
    return res.status(400).json({ error: 'Invalid allocation amount' });
  }

  const session = await mongoose.startSession();

  try {
    let result: { freeBalance: number; allocation: any } | undefined;

    await session.withTransaction(async () => {
      const { userId, engineName, amountUsdt } = req.body;

      // Deduct balance atomically if balance >= amountUsdt
      const updatedUser = await User.findOneAndUpdate(
        { _id: userId, freeUsdtBalance: { $gte: amountUsdt } },
        { $inc: { freeUsdtBalance: -amountUsdt } },
        { new: true, session }
      );

      if (!updatedUser) {
        throw new Error('Insufficient free USDT balance or user not found');
      }

      // Upsert allocation for the engine
      const allocation = await EngineAllocation.findOneAndUpdate(
        { userId, engineName },
        { $inc: { allocatedUsdt: amountUsdt }, status: 'ACTIVE' },
        { upsert: true, new: true, session }
      );

      result = {
        freeBalance: updatedUser.freeUsdtBalance,
        allocation,
      };
    });

    res.json({ success: true, ...(result || {}) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  } finally {
    await session.endSession();
  }
});

export default router; // export it