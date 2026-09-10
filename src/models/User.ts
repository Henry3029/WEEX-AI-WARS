import { Schema, model, models } from 'mongoose';

const UserSchema = new Schema(
  {
    walletAddress: {
      type: String,
      required: [true, 'Wallet address is required'],
      unique: true,
      lowercase: true, // Automatically converts addresses (e.g. 0xAbC... -> 0xabc...) to ensure consistency
      trim: true,
      index: true,
    },
    nonce: {
      type: String,
      required: true,
      // Default initial random nonce generated on creation
      default: () => Math.floor(Math.random() * 1000000).toString(),
    },
    freeUsdtBalance: {
      type: Number,
      default: 0.0,
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