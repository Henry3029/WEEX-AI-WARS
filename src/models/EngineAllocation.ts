import { Schema, model, models } from 'mongoose';

const EngineAllocationSchema = new Schema(
  {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          engineName: { 
                type: String, 
                      enum: ['MAJOR_ENGINE', 'ALT_ENGINE', 'MEME_ENGINE'], 
                            required: true 
                                },
                                    allocatedUsdt: { type: Number, default: 0.0 },
                                        status: { type: String, enum: ['ACTIVE', 'PAUSED'], default: 'ACTIVE' },
                                          },
                                            { timestamps: true }
                                            );

                                            // Enforce unique combination of userId and engineName (like @@unique in Prisma)
                                            EngineAllocationSchema.index({ userId: 1, engineName: 1 }, { unique: true });

                                            const EngineAllocation = models.EngineAllocation || model('EngineAllocation', EngineAllocationSchema);
                                            export default EngineAllocation;