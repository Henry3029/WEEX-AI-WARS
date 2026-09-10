import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { verifyMessage } from 'ethers';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { connectToDatabase } from '@/lib/mongodb';
import User from '@/models/User';
import EngineAllocation from '@/models/EngineAllocation';
import { engineStatesStore, systemLogsStore } from '../AI';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_jwt_secret';

// Express Request Extension for Typed Auth Payload
interface AuthenticatedRequest extends Request {
  userId?: string;
}

// -------------------------------------------------------------
// AUTH MIDDLEWARE: Verifies JWT token from Authorization Header
// -------------------------------------------------------------
const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <TOKEN>"

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.userId = decoded.userId;
    next();
  });
};


// GET ACTIVE ENGINE STATES & ALLOCATIONS
router.get('/engine/status', async (req: Request, res: Response) => {
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

// USER VERIFICATION SIGNATURE
router.post('/auth/verify', async (req: Request, res: Response) => {
  try {
    await connectToDatabase();
    const { walletAddress, signature } = req.body;

    if (!walletAddress || !signature) {
      return res.status(400).json({ error: 'Wallet address and signature required' });
    }

    const normalizedAddress = walletAddress.toLowerCase();
    const user = await User.findOne({ walletAddress: normalizedAddress });

    if (!user) {
      return res.status(404).json({ error: 'User not found. Request a nonce first.' });
    }

    // Verify Signature
    const expectedMessage = `Sign this message to authenticate with WEEX Bot: ${user.nonce}`;
    
    const recoveredAddress = verifyMessage(expectedMessage, signature);
    if (recoveredAddress.toLowerCase() !== normalizedAddress) {
      return res.status(401).json({ error: 'Invalid signature verification failed' });
    }

    // Invalidate Nonce after successful login (prevents replay attacks)
    user.nonce = crypto.randomBytes(16).toString('hex');
    await user.save();

    // Issue standard JWT token
    const token = jwt.sign({ userId: user._id, walletAddress: user.walletAddress }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        walletAddress: user.walletAddress,
        freeUsdtBalance: user.freeUsdtBalance,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 1. GET CURRENT USER PROFILE (/auth/me)
// -------------------------------------------------------------
router.get('/auth/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await connectToDatabase();

    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        freeUsdtBalance: user.freeUsdtBalance,
        createdAt: user.createdAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 2. USER REGISTER
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// 3. USER LOGIN
// -------------------------------------------------------------
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

// -------------------------------------------------------------
// 4. ALLOCATE CAPITAL TO ENGINE (Atomic Mongoose Transaction)
// -------------------------------------------------------------
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
