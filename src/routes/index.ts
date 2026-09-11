import express from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import engineRoutes from './engine.routes.js';
import tradeRoutes from './trade.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);   
router.use('/user', userRoutes);    
router.use('/engine', engineRoutes); 
router.use('/trade', tradeRoutes); 


export default router;