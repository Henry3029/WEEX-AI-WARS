import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_fallback_secret';

// Express Request Extension for Typed Auth Payload
export interface AuthenticatedRequest extends Request {
  userId?: string;
}

// -------------------------------------------------------------
// AUTH MIDDLEWARE: Verifies JWT token from Authorization Header
// -------------------------------------------------------------
export const authenticateToken = (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) => {
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
}; // <-- Properly closed here!