import express, { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import EngineAllocation from '@/models/EngineAllocation';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_jwt_secret';

// 1. USER REGISTER
router.post('/auth/register', async (req: Request, res: Response) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      passwordHash,
      freeUsdtBalance: 1000.0, // Default test credit
    });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        freeUsdtBalance: user.freeUsdtBalance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. USER LOGIN
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    await connectToDatabase();
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        freeUsdtBalance: user.freeUsdtBalance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. ALLOCATE CAPITAL TO ENGINE (Atomic Mongoose Transaction)
router.post('/engine/allocate', async (req: Request, res: Response) => {
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

export default router;