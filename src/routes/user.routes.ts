import express from 'express';
import mongoose from 'mongoose';
import User from '@/models/User';
import { connectToDatabase } from '@/lib/mongodb';
import { Request, Response, NextFunction } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware.js';

const router = express.Router();

// -------------------------------------------------------------
// GET CURRENT USER PROFILE (/api/user/me)
// -------------------------------------------------------------
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await connectToDatabase();

    const user = await User.findById(req.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user._id,
        email: user.email,
        freeUsdtBalance: user.freeUsdtBalance,
        createdAt: user.createdAt,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;