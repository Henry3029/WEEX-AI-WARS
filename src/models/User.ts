import { Schema, model, models } from 'mongoose';

const UserSchema = new Schema(
  {
    walletAddress: {
      type: String,
  unique: true,
  sparse: true, // Allows multiple documents to have no walletAddress without breaking the unique index constraint
  lowercase: true,
  trim: true,
  index: true
    },
    nonce: {
      type: String,
      required: true,
      // Default initial random nonce generated on creation
      default: () => Math.floor(Math.random() * 1000000).toString(),
    },
    freeUsdtBalance: {
      type: Number,
      default: 1000.0,
      min: 0,
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt fields
  }
);

// Prevent re-compilation of the model during Next.js Hot Module Replacement (HMR)
const User = models.User || model('User', UserSchema);

export default User;