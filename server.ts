import 'dotenv/config';

import cors from 'cors';
import { isOriginAllowed } from './src/config/cors';
import express from 'express';
import apiRoutes from './src/routes/index.js';
import mongoose from 'mongoose';

// ==========================================
// 1. DATABASE CONNECTION SETUP
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/weex_bot';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('🍃 [Database] MongoDB connected successfully');

    // 🛠️ One-time drop for old walletAddress index to fix E11000 duplicate error
    try {
      await mongoose.connection.collection('users').dropIndex('walletAddress_1');
      console.log('✅ [Database] Old walletAddress_1 index dropped successfully');
    } catch (err: any) {
      // Safe to ignore if the index was already dropped or doesn't exist
    }
  })
  .catch((err) => console.error('❌ [Database] Connection error:', err.message));

// ==========================================
// 2. EXPRESS SETUP
// ==========================================
const app = express();
const SERVER_PORT = Number(process.env.SERVER_PORT) || 3002;

// Mount CORS middleware first
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy: Request origin blocked.'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Catch-all for malformed JSON payloads
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
  }
  next();
});

// ==========================================
// 4. MOUNT API ROUTES
// ==========================================
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({ status: "online", engine: "WEEX Dual AI Engine Active" });
});

// ==========================================
// 5. START SERVER
// ==========================================
app.listen(SERVER_PORT, '0.0.0.0', () => {
  console.log(`🚀 [Server] Express server active on http://0.0.0.0:${SERVER_PORT}`);
});