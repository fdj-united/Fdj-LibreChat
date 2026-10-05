import { Schema } from 'mongoose';
import { REFILL_INTERVAL_UNITS } from 'librechat-data-provider';
import type * as t from '~/types';

const balanceSchema: Schema<t.IBalance> = new Schema<t.IBalance>({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true,
  },
  // 1000 tokenCredits = 1 mill ($0.001 USD)
  tokenCredits: {
    type: Number,
    default: 0,
  },
  // Automatic refill settings
  autoRefillEnabled: {
    type: Boolean,
    default: false,
  },
  refillIntervalValue: {
    type: Number,
    default: 30,
  },
  refillIntervalUnit: {
    type: String,
    enum: REFILL_INTERVAL_UNITS,
    default: 'days',
  },
  lastRefill: {
    type: Date,
    default: Date.now,
  },
  // amount to add on each refill
  refillAmount: {
    type: Number,
    default: 0,
  },
  tenantId: {
    type: String,
    index: true,
  },
  /** Credits held by in-flight requests; released when each request settles, or pruned once expired */
  reservations: {
    type: [
      {
        _id: false,
        id: { type: String, required: true },
        amount: { type: Number, required: true },
        expiresAt: { type: Date, required: true },
      },
    ],
    default: undefined,
    select: false,
  },
  reservedCredits: {
    type: Number,
    select: false,
  },
  pendingRefill: {
    type: {
      transactionId: { type: Schema.Types.ObjectId, required: true },
      rawAmount: { type: Number, required: true },
    },
    _id: false,
    default: undefined,
    select: false,
  },
  // Bounded ring buffer of recently applied admin-credit idempotency keys.
  // See `applyIdempotentCredit` in methods/transaction.ts.
  recentIdempotencyKeys: {
    type: [String],
    default: undefined,
  },
});

/**
 * Exactly one Balance document per user per tenant. Without this, concurrent
 * "first ever credit" upserts (in `updateBalance`'s and `applyIdempotentCredit`'s
 * lazy-create branch) can each independently decide no document exists yet and
 * insert their own — see `migrations/balanceIndexes.ts` for the repair migration
 * this depends on for already-populated deployments. That migration refuses to
 * build this index at all while any duplicate group can't be safely merged, so
 * it's never created over data that would violate it.
 */
balanceSchema.index({ user: 1, tenantId: 1 }, { unique: true });

export default balanceSchema;
