import { Schema, model, models } from 'mongoose';

const UserSchema = new Schema(
  {
    // Web3 / Wallet Auth Fields
    walletAddress: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    nonce: {
      type: String,
      required: true,
      default: () => Math.floor(Math.random() * 1000000).toString(),
    },

    // Standard Web2 Auth Fields
    email: {
      type: String,
      unique: true,
      sparse: true, // Allows wallet users to sign up without requiring an email
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: false, // Optional so wallet-only users don't break validation
    },

    // Application Balances
    freeUsdtBalance: {
      type: Number,
      default: 1000.0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

const User = models.User || model('User', UserSchema);

export default User;