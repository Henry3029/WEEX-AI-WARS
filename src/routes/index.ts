import express from 'express';
import authRoutes from './auth.routes.ts';
import userRoutes from './user.routes.ts';
import engineRoutes from './engine.routes.ts';
import tradeRoutes from './trade.routes.ts';

const router = express.Router();

router.use('/auth', authRoutes);   
router.use('/user', userRoutes);    
router.use('/engine', engineRoutes); 
router.use('/trade', tradeRoutes); 


export default router;