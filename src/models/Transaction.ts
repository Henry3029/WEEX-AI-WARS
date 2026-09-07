import { Schema, model, models } from 'mongoose';

const TransactionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
            enum: ['DEPOSIT', 'WITHDRAWAL', 'ALLOCATION', 'PROFIT_PAYOUT'], 
                required: true 
                  },
                    amount: { type: Number, required: true },
                      status: { 
                          type: String, 
                              enum: ['PENDING', 'COMPLETED', 'FAILED'], 
                                  default: 'COMPLETED' 
                                    },
                                      reference: { type: String, default: null },
                                        createdAt: { type: Date, default: Date.now },
                                        });

                                        const Transaction = models.Transaction || model('Transaction', TransactionSchema);
                                        export default Transaction;