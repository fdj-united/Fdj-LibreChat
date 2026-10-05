import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IBalance, IBalanceRequest } from '..';
import type { ITransaction } from '~/schema/transaction';
import type { TxData } from './transaction';
import { createTxMethods, tokenValues, premiumTokenValues, defaultRate } from './tx';
import { matchModelName, findMatchingPattern } from './test-helpers';
import { createBalanceRequestMethods } from './balanceRequest';
import { createSpendTokensMethods } from './spendTokens';
import { createTransactionMethods } from './transaction';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Balance: mongoose.Model<IBalance>;
let Transaction: mongoose.Model<ITransaction>;
let spendTokens: ReturnType<typeof createSpendTokensMethods>['spendTokens'];
let spendStructuredTokens: ReturnType<typeof createSpendTokensMethods>['spendStructuredTokens'];
let createTransaction: ReturnType<typeof createTransactionMethods>['createTransaction'];
let createStructuredTransaction: ReturnType<
  typeof createTransactionMethods
>['createStructuredTransaction'];
let applyIdempotentCredit: ReturnType<typeof createTransactionMethods>['applyIdempotentCredit'];
let claimAuditRecording: ReturnType<typeof createTransactionMethods>['claimAuditRecording'];
let markAuditRecorded: ReturnType<typeof createTransactionMethods>['markAuditRecorded'];
let releaseAuditRecordingLease: ReturnType<
  typeof createTransactionMethods
>['releaseAuditRecordingLease'];
let ensureTransactionIdempotencyIndex: ReturnType<
  typeof createTransactionMethods
>['ensureTransactionIdempotencyIndex'];
let findBalancesByUsers: ReturnType<typeof createTransactionMethods>['findBalancesByUsers'];
let createAutoRefillTransaction: ReturnType<
  typeof createTransactionMethods
>['createAutoRefillTransaction'];
let getMultiplier: ReturnType<typeof createTxMethods>['getMultiplier'];
let getCacheMultiplier: ReturnType<typeof createTxMethods>['getCacheMultiplier'];
let balanceRequestMethods: ReturnType<typeof createBalanceRequestMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Register models
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);

  Balance = mongoose.models.Balance;
  Transaction = mongoose.models.Transaction;

  // Create methods from factories (following the chain in methods/index.ts)
  const txMethods = createTxMethods(mongoose, { matchModelName, findMatchingPattern });
  getMultiplier = txMethods.getMultiplier;
  getCacheMultiplier = txMethods.getCacheMultiplier;

  balanceRequestMethods = createBalanceRequestMethods(mongoose);

  const transactionMethods = createTransactionMethods(mongoose, {
    getMultiplier: txMethods.getMultiplier,
    getCacheMultiplier: txMethods.getCacheMultiplier,
    findPendingBalanceRequestByUser: balanceRequestMethods.findPendingBalanceRequestByUser,
    claimBalanceRequestResolution: balanceRequestMethods.claimBalanceRequestResolution,
    releaseBalanceRequestResolutionLease:
      balanceRequestMethods.releaseBalanceRequestResolutionLease,
    resolveBalanceRequestIfPending: balanceRequestMethods.resolveBalanceRequestIfPending,
  });
  createTransaction = transactionMethods.createTransaction;
  createStructuredTransaction = transactionMethods.createStructuredTransaction;
  applyIdempotentCredit = transactionMethods.applyIdempotentCredit;
  claimAuditRecording = transactionMethods.claimAuditRecording;
  markAuditRecorded = transactionMethods.markAuditRecorded;
  releaseAuditRecordingLease = transactionMethods.releaseAuditRecordingLease;
  ensureTransactionIdempotencyIndex = transactionMethods.ensureTransactionIdempotencyIndex;
  findBalancesByUsers = transactionMethods.findBalancesByUsers;
  createAutoRefillTransaction = transactionMethods.createAutoRefillTransaction;

  const spendMethods = createSpendTokensMethods(mongoose, {
    createTransaction: transactionMethods.createTransaction,
    createStructuredTransaction: transactionMethods.createStructuredTransaction,
    maybeApplyAutoRefill: transactionMethods.maybeApplyAutoRefill,
  });
  spendTokens = spendMethods.spendTokens;
  spendStructuredTokens = spendMethods.spendStructuredTokens;

  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  // dropDatabase wipes indexes along with the data — re-provision the ones
  // the concurrency/idempotency tests below depend on actually being
  // enforced by MongoDB, not just by this file's application-level logic.
  await Balance.createIndexes();
  await ensureTransactionIdempotencyIndex();
});

describe('Regular Token Spending Tests', () => {
  test('Balance should decrease when spending tokens with spendTokens', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000; // $10.00
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
    };

    // Act
    await spendTokens(txData, tokenUsage);

    // Assert
    const updatedBalance = await Balance.findOne({ user: userId });
    const promptMultiplier = getMultiplier({ model, tokenType: 'prompt' });
    const completionMultiplier = getMultiplier({ model, tokenType: 'completion' });
    const expectedTotalCost = 100 * promptMultiplier + 50 * completionMultiplier;
    const expectedBalance = initialBalance - expectedTotalCost;

    expect(updatedBalance?.tokenCredits).toBeCloseTo(expectedBalance, 0);
  });

  test('spendTokens should handle zero completion tokens', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: 100,
      completionTokens: 0,
    };

    // Act
    await spendTokens(txData, tokenUsage);

    // Assert
    const updatedBalance = await Balance.findOne({ user: userId });
    const promptMultiplier = getMultiplier({ model, tokenType: 'prompt' });
    const expectedCost = 100 * promptMultiplier;
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendTokens should handle undefined token counts', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {};

    // Act
    const result = await spendTokens(txData, tokenUsage);

    // Assert: No transaction should be created
    expect(result).toBeUndefined();
  });

  test('spendTokens should handle only prompt tokens', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = { promptTokens: 100 };

    // Act
    await spendTokens(txData, tokenUsage);

    // Assert
    const updatedBalance = await Balance.findOne({ user: userId });
    const promptMultiplier = getMultiplier({ model, tokenType: 'prompt' });
    const expectedCost = 100 * promptMultiplier;
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendTokens should not update balance when balance feature is disabled', async () => {
    // Arrange: Balance config is now passed directly in txData
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: false },
    };

    const tokenUsage = {
      promptTokens: 100,
      completionTokens: 50,
    };

    // Act
    await spendTokens(txData, tokenUsage);

    // Assert: Balance should remain unchanged.
    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBe(initialBalance);
  });
});

describe('Structured Token Spending Tests', () => {
  test('Balance should decrease and rawAmount should be set when spending a large number of structured tokens', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 17613154.55; // $17.61
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData = {
      user: userId,
      conversationId: 'c23a18da-706c-470a-ac28-ec87ed065199',
      model,
      context: 'message',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 11,
        write: 140522,
        read: 0,
      },
      completionTokens: 5,
    };

    const promptMultiplier = getMultiplier({ model, tokenType: 'prompt' });
    const completionMultiplier = getMultiplier({ model, tokenType: 'completion' });
    const writeMultiplier = getCacheMultiplier({ model, cacheType: 'write' }) ?? promptMultiplier;
    const readMultiplier = getCacheMultiplier({ model, cacheType: 'read' }) ?? promptMultiplier;

    // Act
    const result = await spendStructuredTokens(txData, tokenUsage);

    // Calculate expected costs.
    const expectedPromptCost =
      tokenUsage.promptTokens.input * promptMultiplier +
      tokenUsage.promptTokens.write * writeMultiplier +
      tokenUsage.promptTokens.read * readMultiplier;
    const expectedCompletionCost = tokenUsage.completionTokens * completionMultiplier;
    const expectedTotalCost = expectedPromptCost + expectedCompletionCost;
    const expectedBalance = initialBalance - expectedTotalCost;

    // Assert
    expect(result?.completion?.balance).toBeLessThan(initialBalance);
    const allowedDifference = 100;
    expect(Math.abs((result?.completion?.balance ?? 0) - expectedBalance)).toBeLessThan(
      allowedDifference,
    );
    const balanceDecrease = initialBalance - (result?.completion?.balance ?? 0);
    expect(balanceDecrease).toBeCloseTo(expectedTotalCost, 0);

    const expectedPromptTokenValue = -expectedPromptCost;
    const expectedCompletionTokenValue = -expectedCompletionCost;
    expect(result?.prompt?.prompt).toBeCloseTo(expectedPromptTokenValue, 1);
    expect(result?.completion?.completion).toBe(expectedCompletionTokenValue);
  });

  test('should handle zero completion tokens in structured spending', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 17613154.55;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData = {
      user: userId,
      conversationId: 'test-convo',
      model,
      context: 'message',
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 10,
        write: 100,
        read: 5,
      },
      completionTokens: 0,
    };

    // Act
    const result = await spendStructuredTokens(txData, tokenUsage);

    // Assert
    expect(result.prompt).toBeDefined();
    expect(result.completion).toBeUndefined();
    expect(result?.prompt?.prompt).toBeLessThan(0);
  });

  test('should handle only prompt tokens in structured spending', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 17613154.55;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData = {
      user: userId,
      conversationId: 'test-convo',
      model,
      context: 'message',
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 10,
        write: 100,
        read: 5,
      },
    };

    // Act
    const result = await spendStructuredTokens(txData, tokenUsage);

    // Assert
    expect(result.prompt).toBeDefined();
    expect(result.completion).toBeUndefined();
    expect(result?.prompt?.prompt).toBeLessThan(0);
  });

  test('should handle undefined token counts in structured spending', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 17613154.55;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData = {
      user: userId,
      conversationId: 'test-convo',
      model,
      context: 'message',
      balance: { enabled: true },
    };

    const tokenUsage = {};

    // Act
    const result = await spendStructuredTokens(txData, tokenUsage);

    // Assert
    expect(result).toEqual({
      prompt: undefined,
      completion: undefined,
    });
  });

  test('should handle incomplete context for completion tokens', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 17613154.55;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData = {
      user: userId,
      conversationId: 'test-convo',
      model,
      context: 'incomplete',
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 10,
        write: 100,
        read: 5,
      },
      completionTokens: 50,
    };

    // Act
    const result = await spendStructuredTokens(txData, tokenUsage);

    // Assert:
    // (Assuming a multiplier for completion of 15 and a cancel rate of 1.15 as noted in the original test.)
    expect(result?.completion?.completion).toBeCloseTo(-50 * 15 * 1.15, 0);
  });
});

describe('NaN Handling Tests', () => {
  test('should skip transaction creation when rawAmount is NaN', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      rawAmount: NaN,
      tokenType: 'prompt',
      balance: { enabled: true },
    };

    // Act
    const result = await createTransaction(txData);

    // Assert: No transaction should be created and balance remains unchanged.
    expect(result).toBeUndefined();
    const balance = await Balance.findOne({ user: userId });
    expect(balance?.tokenCredits).toBe(initialBalance);
  });
});

describe('Transactions Config Tests', () => {
  test('createTransaction should not save when transactions.enabled is false', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      rawAmount: -100,
      tokenType: 'prompt',
      transactions: { enabled: false },
    };

    // Act
    const result = await createTransaction(txData);

    // Assert: No transaction should be created
    expect(result).toBeUndefined();
    const transactions = await Transaction.find({ user: userId });
    expect(transactions).toHaveLength(0);
    const balance = await Balance.findOne({ user: userId });
    expect(balance?.tokenCredits).toBe(initialBalance);
  });

  test('createTransaction should save when transactions.enabled is true', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      rawAmount: -100,
      tokenType: 'prompt',
      transactions: { enabled: true },
      balance: { enabled: true },
    };

    // Act
    const result = await createTransaction(txData);

    // Assert: Transaction should be created
    expect(result).toBeDefined();
    expect(result?.balance).toBeLessThan(initialBalance);
    const transactions = await Transaction.find({ user: userId });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].rawAmount).toBe(-100);
  });

  test('createTransaction should save when balance.enabled is true even if transactions config is missing', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      rawAmount: -100,
      tokenType: 'prompt',
      balance: { enabled: true },
      // No transactions config provided
    };

    // Act
    const result = await createTransaction(txData);

    // Assert: Transaction should be created (backward compatibility)
    expect(result).toBeDefined();
    expect(result?.balance).toBeLessThan(initialBalance);
    const transactions = await Transaction.find({ user: userId });
    expect(transactions).toHaveLength(1);
  });

  test('createTransaction should save transaction but not update balance when balance is disabled but transactions enabled', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-3.5-turbo';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'test',
      endpointTokenConfig: null,
      rawAmount: -100,
      tokenType: 'prompt',
      transactions: { enabled: true },
      balance: { enabled: false },
    };

    // Act
    const result = await createTransaction(txData);

    // Assert: Transaction should be created but balance unchanged
    expect(result).toBeUndefined();
    const transactions = await Transaction.find({ user: userId });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].rawAmount).toBe(-100);
    const balance = await Balance.findOne({ user: userId });
    expect(balance?.tokenCredits).toBe(initialBalance);
  });

  test('createStructuredTransaction should not save when transactions.enabled is false', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'message',
      tokenType: 'prompt',
      inputTokens: -10,
      writeTokens: -100,
      readTokens: -5,
      transactions: { enabled: false },
    };

    // Act
    const result = await createStructuredTransaction(txData);

    // Assert: No transaction should be created
    expect(result).toBeUndefined();
    const transactions = await Transaction.find({ user: userId });
    expect(transactions).toHaveLength(0);
    const balance = await Balance.findOne({ user: userId });
    expect(balance?.tokenCredits).toBe(initialBalance);
  });

  test('createStructuredTransaction should save transaction but not update balance when balance is disabled but transactions enabled', async () => {
    // Arrange
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 10000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-3-5-sonnet';
    const txData: TxData = {
      user: userId,
      conversationId: 'test-conversation-id',
      model,
      context: 'message',
      tokenType: 'prompt',
      inputTokens: -10,
      writeTokens: -100,
      readTokens: -5,
      transactions: { enabled: true },
      balance: { enabled: false },
    };

    // Act
    const result = await createStructuredTransaction(txData);

    // Assert: Transaction should be created but balance unchanged
    expect(result).toBeUndefined();
    const transactions = await Transaction.find({ user: userId });
    expect(transactions).toHaveLength(1);
    expect(transactions[0].inputTokens).toBe(-10);
    expect(transactions[0].writeTokens).toBe(-100);
    expect(transactions[0].readTokens).toBe(-5);
    const balance = await Balance.findOne({ user: userId });
    expect(balance?.tokenCredits).toBe(initialBalance);
  });
});

describe('Partial endpointTokenConfig fallback', () => {
  const endpointTokenConfig = {
    'custom-model': { prompt: 1.5, completion: 4.5, read: 0.3 },
  };

  test('uses override rates for a listed model', () => {
    expect(getMultiplier({ model: 'custom-model', tokenType: 'prompt', endpointTokenConfig })).toBe(
      1.5,
    );
    expect(
      getCacheMultiplier({ model: 'custom-model', cacheType: 'read', endpointTokenConfig }),
    ).toBe(0.3);
  });

  test('falls back to standard tables for a model absent from the override', () => {
    const fallbackPrompt = getMultiplier({ model: 'gpt-4', tokenType: 'prompt' });
    expect(getMultiplier({ model: 'gpt-4', tokenType: 'prompt', endpointTokenConfig })).toBe(
      fallbackPrompt,
    );
    expect(getMultiplier({ model: 'gpt-4', tokenType: 'prompt', endpointTokenConfig })).not.toBe(
      defaultRate,
    );

    const fallbackCacheRead = getCacheMultiplier({ model: 'claude-3-5-sonnet', cacheType: 'read' });
    expect(
      getCacheMultiplier({ model: 'claude-3-5-sonnet', cacheType: 'read', endpointTokenConfig }),
    ).toBe(fallbackCacheRead);
  });
});

describe('calculateTokenValue Edge Cases', () => {
  test('should derive multiplier from model when valueKey is not provided', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gpt-4';
    const promptTokens = 1000;

    const result = await createTransaction({
      user: userId,
      conversationId: 'test-no-valuekey',
      model,
      tokenType: 'prompt',
      rawAmount: -promptTokens,
      context: 'test',
      balance: { enabled: true },
    });

    const expectedRate = getMultiplier({ model, tokenType: 'prompt' });
    expect(result?.rate).toBe(expectedRate);

    const tx = await Transaction.findOne({ user: userId });
    expect(tx?.tokenValue).toBe(-promptTokens * expectedRate);
    expect(tx?.rate).toBe(expectedRate);
  });

  test('should derive valueKey and apply correct rate for an unknown model with tokenType', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    await createTransaction({
      user: userId,
      conversationId: 'test-unknown-model',
      model: 'some-unrecognized-model-xyz',
      tokenType: 'prompt',
      rawAmount: -500,
      context: 'test',
      balance: { enabled: true },
    });

    const tx = await Transaction.findOne({ user: userId });
    expect(tx?.rate).toBeDefined();
    expect(tx?.rate).toBeGreaterThan(0);
    expect(tx?.tokenValue).toBe((tx?.rawAmount ?? 0) * (tx?.rate ?? 0));
  });

  test('should correctly apply model-derived multiplier without valueKey for completion', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-opus-4-6';
    const completionTokens = 500;

    const result = await createTransaction({
      user: userId,
      conversationId: 'test-completion-no-valuekey',
      model,
      tokenType: 'completion',
      rawAmount: -completionTokens,
      context: 'test',
      balance: { enabled: true },
    });

    const expectedRate = getMultiplier({ model, tokenType: 'completion' });
    expect(expectedRate).toBe(tokenValues[model].completion);
    expect(result?.rate).toBe(expectedRate);

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(
      initialBalance - completionTokens * expectedRate,
      0,
    );
  });
});

describe('Premium Token Pricing Integration Tests', () => {
  test('spendTokens should apply standard pricing when prompt tokens are below premium threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1';
    const promptTokens = 100000;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-premium-below',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const standardPromptRate = tokenValues[model].prompt;
    const standardCompletionRate = tokenValues[model].completion;
    const expectedCost =
      promptTokens * standardPromptRate + completionTokens * standardCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendTokens should apply premium pricing when prompt tokens exceed premium threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1';
    const promptTokens = 250000;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-premium-above',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const premiumPromptRate = premiumTokenValues[model].prompt;
    const premiumCompletionRate = premiumTokenValues[model].completion;
    const expectedCost =
      promptTokens * premiumPromptRate + completionTokens * premiumCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendTokens should apply standard pricing at exactly the premium threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1';
    const promptTokens = premiumTokenValues[model].threshold;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-premium-exact',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const standardPromptRate = tokenValues[model].prompt;
    const standardCompletionRate = tokenValues[model].completion;
    const expectedCost =
      promptTokens * standardPromptRate + completionTokens * standardCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendStructuredTokens should apply premium pricing when total input tokens exceed threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1';
    const txData = {
      user: userId,
      conversationId: 'test-structured-premium',
      model,
      context: 'message',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 200000,
        write: 10000,
        read: 5000,
      },
      completionTokens: 1000,
    };

    const totalInput =
      tokenUsage.promptTokens.input + tokenUsage.promptTokens.write + tokenUsage.promptTokens.read;

    await spendStructuredTokens(txData, tokenUsage);

    const premiumPromptRate = premiumTokenValues[model].prompt;
    const premiumCompletionRate = premiumTokenValues[model].completion;
    const promptMultiplier = getMultiplier({
      model,
      tokenType: 'prompt',
      inputTokenCount: totalInput,
    });
    const writeMultiplier = getCacheMultiplier({ model, cacheType: 'write' }) ?? promptMultiplier;
    const readMultiplier = getCacheMultiplier({ model, cacheType: 'read' }) ?? promptMultiplier;

    const expectedPromptCost =
      tokenUsage.promptTokens.input * premiumPromptRate +
      tokenUsage.promptTokens.write * writeMultiplier +
      tokenUsage.promptTokens.read * readMultiplier;
    const expectedCompletionCost = tokenUsage.completionTokens * premiumCompletionRate;
    const expectedTotalCost = expectedPromptCost + expectedCompletionCost;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(totalInput).toBeGreaterThan(premiumTokenValues[model].threshold);
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedTotalCost, 0);
  });

  test('spendStructuredTokens should apply standard pricing when total input tokens are below threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1';
    const txData = {
      user: userId,
      conversationId: 'test-structured-standard',
      model,
      context: 'message',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 50000,
        write: 10000,
        read: 5000,
      },
      completionTokens: 1000,
    };

    const totalInput =
      tokenUsage.promptTokens.input + tokenUsage.promptTokens.write + tokenUsage.promptTokens.read;

    await spendStructuredTokens(txData, tokenUsage);

    const standardPromptRate = tokenValues[model].prompt;
    const standardCompletionRate = tokenValues[model].completion;
    const promptMultiplier = getMultiplier({
      model,
      tokenType: 'prompt',
      inputTokenCount: totalInput,
    });
    const writeMultiplier = getCacheMultiplier({ model, cacheType: 'write' }) ?? promptMultiplier;
    const readMultiplier = getCacheMultiplier({ model, cacheType: 'read' }) ?? promptMultiplier;

    const expectedPromptCost =
      tokenUsage.promptTokens.input * standardPromptRate +
      tokenUsage.promptTokens.write * writeMultiplier +
      tokenUsage.promptTokens.read * readMultiplier;
    const expectedCompletionCost = tokenUsage.completionTokens * standardCompletionRate;
    const expectedTotalCost = expectedPromptCost + expectedCompletionCost;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(totalInput).toBeLessThanOrEqual(premiumTokenValues[model].threshold);
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedTotalCost, 0);
  });

  test('spendTokens should apply standard pricing for gemini-3.1-pro-preview below threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1-pro-preview';
    const promptTokens = 100000;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-gemini31-below',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const standardPromptRate = tokenValues['gemini-3.1'].prompt;
    const standardCompletionRate = tokenValues['gemini-3.1'].completion;
    const expectedCost =
      promptTokens * standardPromptRate + completionTokens * standardCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendTokens should apply premium pricing for gemini-3.1-pro-preview above threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1-pro-preview';
    const promptTokens = 250000;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-gemini31-above',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const premiumPromptRate = premiumTokenValues['gemini-3.1'].prompt;
    const premiumCompletionRate = premiumTokenValues['gemini-3.1'].completion;
    const expectedCost =
      promptTokens * premiumPromptRate + completionTokens * premiumCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendTokens should apply standard pricing for gemini-3.1-pro-preview at exactly the threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1-pro-preview';
    const promptTokens = premiumTokenValues['gemini-3.1'].threshold;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-gemini31-exact',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const standardPromptRate = tokenValues['gemini-3.1'].prompt;
    const standardCompletionRate = tokenValues['gemini-3.1'].completion;
    const expectedCost =
      promptTokens * standardPromptRate + completionTokens * standardCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });

  test('spendStructuredTokens should apply premium pricing for gemini-3.1 when total input exceeds threshold', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'gemini-3.1-pro-preview';
    const txData = {
      user: userId,
      conversationId: 'test-gemini31-structured-premium',
      model,
      context: 'message',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    const tokenUsage = {
      promptTokens: {
        input: 200000,
        write: 10000,
        read: 5000,
      },
      completionTokens: 1000,
    };

    const totalInput =
      tokenUsage.promptTokens.input + tokenUsage.promptTokens.write + tokenUsage.promptTokens.read;

    await spendStructuredTokens(txData, tokenUsage);

    const premiumPromptRate = premiumTokenValues['gemini-3.1'].prompt;
    const premiumCompletionRate = premiumTokenValues['gemini-3.1'].completion;
    const promptMultiplier = getMultiplier({
      model,
      tokenType: 'prompt',
      inputTokenCount: totalInput,
    });
    const writeMultiplier = getCacheMultiplier({ model, cacheType: 'write' }) ?? promptMultiplier;
    const readMultiplier = getCacheMultiplier({ model, cacheType: 'read' }) ?? promptMultiplier;

    const expectedPromptCost =
      tokenUsage.promptTokens.input * premiumPromptRate +
      tokenUsage.promptTokens.write * writeMultiplier +
      tokenUsage.promptTokens.read * readMultiplier;
    const expectedCompletionCost = tokenUsage.completionTokens * premiumCompletionRate;
    const expectedTotalCost = expectedPromptCost + expectedCompletionCost;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(totalInput).toBeGreaterThan(premiumTokenValues['gemini-3.1'].threshold);
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedTotalCost, 0);
  });

  test('non-premium models should not be affected by inputTokenCount regardless of prompt size', async () => {
    const userId = new mongoose.Types.ObjectId();
    const initialBalance = 100000000;
    await Balance.create({ user: userId, tokenCredits: initialBalance });

    const model = 'claude-opus-4-6';
    const promptTokens = 300000;
    const completionTokens = 500;

    const txData = {
      user: userId,
      conversationId: 'test-no-premium',
      model,
      context: 'test',
      endpointTokenConfig: null,
      balance: { enabled: true },
    };

    await spendTokens(txData, { promptTokens, completionTokens });

    const standardPromptRate = getMultiplier({ model, tokenType: 'prompt' });
    const standardCompletionRate = getMultiplier({ model, tokenType: 'completion' });
    const expectedCost =
      promptTokens * standardPromptRate + completionTokens * standardCompletionRate;

    const updatedBalance = await Balance.findOne({ user: userId });
    expect(updatedBalance?.tokenCredits).toBeCloseTo(initialBalance - expectedCost, 0);
  });
});

describe('applyIdempotentCredit', () => {
  test('fresh call applies the increment, records the key, and writes the ledger row', async () => {
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({ user: userId, tokenCredits: 1000 });

    const result = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: 500,
      idempotencyKey: 'key-1',
      context: 'admin',
    });

    expect(result).toEqual({
      resultingBalance: 1500,
      applied: true,
      transactionId: expect.any(String),
    });
    const stored = await Balance.findOne({ user: userId }).lean();
    expect(stored?.tokenCredits).toBe(1500);
    expect(stored?.recentIdempotencyKeys).toEqual(['key-1']);
    const ledgerRow = await Transaction.findOne({ idempotencyKey: 'key-1' }).lean();
    expect(ledgerRow).not.toBeNull();
    expect(ledgerRow?._id.toString()).toBe(result.transactionId);
    expect(ledgerRow?.rawAmount).toBe(500);
  });

  test('lazily creates a Balance document, correctly populated, when none exists yet', async () => {
    const userId = new mongoose.Types.ObjectId();

    const result = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: 250,
      idempotencyKey: 'key-fresh-user',
      context: 'admin',
    });

    expect(result.resultingBalance).toBe(250);
    expect(result.applied).toBe(true);
    const stored = await Balance.findOne({ user: userId }).lean();
    expect(stored).not.toBeNull();
    expect(stored?.user.toString()).toBe(userId.toString());
    expect(stored?.tokenCredits).toBe(250);
  });

  test('never lets the balance go below zero', async () => {
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({ user: userId, tokenCredits: 100 });

    const result = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: -500,
      idempotencyKey: 'key-negative',
      context: 'admin',
    });

    expect(result.resultingBalance).toBe(0);
  });

  test('a retry with the same key is a no-op — does not double-increment or double-ledger', async () => {
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({ user: userId, tokenCredits: 1000 });

    const first = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: 500,
      idempotencyKey: 'retry-key',
      context: 'admin',
    });
    const second = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: 500,
      idempotencyKey: 'retry-key',
      context: 'admin',
    });

    expect(first.applied).toBe(true);
    expect(first.resultingBalance).toBe(1500);
    expect(second.applied).toBe(false);
    expect(second.resultingBalance).toBe(1500);
    expect(second.transactionId).toBe(first.transactionId);

    const stored = await Balance.findOne({ user: userId }).lean();
    expect(stored?.tokenCredits).toBe(1500);
    const ledgerCount = await Transaction.countDocuments({ idempotencyKey: 'retry-key' });
    expect(ledgerCount).toBe(1);
  });

  test('concurrent calls with the same key apply the increment exactly once', async () => {
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({ user: userId, tokenCredits: 1000 });

    const [first, second] = await Promise.all([
      applyIdempotentCredit({
        user: userId.toString(),
        incrementValue: 500,
        idempotencyKey: 'concurrent-key',
        context: 'admin',
      }),
      applyIdempotentCredit({
        user: userId.toString(),
        incrementValue: 500,
        idempotencyKey: 'concurrent-key',
        context: 'admin',
      }),
    ]);

    const applied = [first.applied, second.applied];
    expect(applied.filter((value) => value === true)).toHaveLength(1);
    expect(applied.filter((value) => value === false)).toHaveLength(1);
    expect(first.resultingBalance).toBe(1500);
    expect(second.resultingBalance).toBe(1500);

    const stored = await Balance.findOne({ user: userId }).lean();
    expect(stored?.tokenCredits).toBe(1500);
    const ledgerCount = await Transaction.countDocuments({ idempotencyKey: 'concurrent-key' });
    expect(ledgerCount).toBe(1);
  });

  test('concurrent first-ever credits for a brand-new user never create duplicate Balance documents', async () => {
    // Regression test: `applyIdempotentCredit`'s own idempotency check only
    // works if there is exactly one Balance document per user — the unique
    // `{ user, tenantId }` index (schema/balance.ts) is what makes the
    // lazy-create race (via `updateBalance`'s upsert) converge to one
    // document instead of several, each with its own independent
    // `recentIdempotencyKeys`. Distinct keys, matching distinct legitimate
    // credits landing on the same first-time user simultaneously.
    const userId = new mongoose.Types.ObjectId();
    const concurrency = 8;
    const incrementValue = 500;

    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        applyIdempotentCredit({
          user: userId.toString(),
          incrementValue,
          idempotencyKey: `fresh-user-key-${i}`,
          context: 'admin',
        }),
      ),
    );

    expect(results.every((r) => r.applied)).toBe(true);

    const docs = await Balance.find({ user: userId }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].tokenCredits).toBe(concurrency * incrementValue);
  });

  test('keeps only the most recent MAX_RECENT_IDEMPOTENCY_KEYS keys in the ring buffer', async () => {
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({ user: userId, tokenCredits: 0 });

    const totalKeys = 51; // one past the 50-key cap
    for (let i = 0; i < totalKeys; i++) {
      await applyIdempotentCredit({
        user: userId.toString(),
        incrementValue: 1,
        idempotencyKey: `bounded-key-${i}`,
        context: 'admin',
      });
    }

    const stored = await Balance.findOne({ user: userId }).lean();
    expect(stored?.recentIdempotencyKeys).toHaveLength(50);
    expect(stored?.recentIdempotencyKeys).not.toContain('bounded-key-0');
    expect(stored?.recentIdempotencyKeys).toContain('bounded-key-50');
    expect(stored?.tokenCredits).toBe(totalKeys);
  });

  test('rejects a replay of a key already evicted from the ring buffer, via the durable ledger', async () => {
    // The ring buffer alone cannot detect this — bounded-key-0 has long since
    // fallen out of it by the time the 51st distinct key lands. The ledger
    // write is no longer a separate, skippable step (the whole point of this
    // fix) — it happens unconditionally inside applyIdempotentCredit itself —
    // so by the time eviction could possibly happen, the durable row already
    // exists and stops the replay from re-applying.
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({ user: userId, tokenCredits: 0 });

    const totalKeys = 51;
    for (let i = 0; i < totalKeys; i++) {
      await applyIdempotentCredit({
        user: userId.toString(),
        incrementValue: 1,
        idempotencyKey: `evictable-key-${i}`,
        context: 'admin',
      });
    }

    const balanceAfterFirstPass = await Balance.findOne({ user: userId }).lean();
    expect(balanceAfterFirstPass?.recentIdempotencyKeys).not.toContain('evictable-key-0');
    expect(balanceAfterFirstPass?.tokenCredits).toBe(totalKeys);

    const replay = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: 1,
      idempotencyKey: 'evictable-key-0',
      context: 'admin',
    });

    expect(replay.applied).toBe(false);
    expect(replay.resultingBalance).toBe(totalKeys);
    const balanceAfterReplay = await Balance.findOne({ user: userId }).lean();
    expect(balanceAfterReplay?.tokenCredits).toBe(totalKeys);
  });

  test('repairs a missing ledger row on retry even when the ring buffer still holds the key', async () => {
    // Simulates a crash between the balance update and the ledger write on a
    // *prior* attempt: manually put the key in the ring buffer without ever
    // writing its ledger row, then confirm a retry writes the ledger (without
    // re-incrementing the balance) rather than skipping it forever.
    const userId = new mongoose.Types.ObjectId();
    await Balance.create({
      user: userId,
      tokenCredits: 500,
      recentIdempotencyKeys: ['crashed-key'],
    });
    expect(await Transaction.findOne({ idempotencyKey: 'crashed-key' }).lean()).toBeNull();

    const result = await applyIdempotentCredit({
      user: userId.toString(),
      incrementValue: 500,
      idempotencyKey: 'crashed-key',
      context: 'admin',
    });

    expect(result.applied).toBe(false); // balance was already incremented
    expect(result.resultingBalance).toBe(500); // not re-incremented to 1000
    const ledgerRow = await Transaction.findOne({ idempotencyKey: 'crashed-key' }).lean();
    expect(ledgerRow).not.toBeNull(); // but the missing ledger row is repaired
    expect(ledgerRow?._id.toString()).toBe(result.transactionId);
  });
});

describe('claimAuditRecording', () => {
  test('returns true for the first caller and false for every call after that', async () => {
    const { transactionId } = await applyIdempotentCredit({
      user: new mongoose.Types.ObjectId().toString(),
      incrementValue: 500,
      idempotencyKey: 'claim-key-1',
      context: 'admin',
    });

    const first = await claimAuditRecording(transactionId);
    const second = await claimAuditRecording(transactionId);
    const third = await claimAuditRecording(transactionId);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(false);
  });

  test('exactly one caller wins when claimed concurrently', async () => {
    const { transactionId } = await applyIdempotentCredit({
      user: new mongoose.Types.ObjectId().toString(),
      incrementValue: 500,
      idempotencyKey: 'claim-key-2',
      context: 'admin',
    });

    const results = await Promise.all([
      claimAuditRecording(transactionId),
      claimAuditRecording(transactionId),
      claimAuditRecording(transactionId),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test('markAuditRecorded makes the claim permanently unavailable, even after the lease would have expired', async () => {
    const { transactionId } = await applyIdempotentCredit({
      user: new mongoose.Types.ObjectId().toString(),
      incrementValue: 500,
      idempotencyKey: 'claim-key-3',
      context: 'admin',
    });

    expect(await claimAuditRecording(transactionId, 10)).toBe(true);
    await markAuditRecorded(transactionId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await claimAuditRecording(transactionId, 10)).toBe(false);
  });

  test('releaseAuditRecordingLease lets a failed write be reclaimed immediately, without auditRecorded ever being set', async () => {
    const { transactionId } = await applyIdempotentCredit({
      user: new mongoose.Types.ObjectId().toString(),
      incrementValue: 500,
      idempotencyKey: 'claim-key-4',
      context: 'admin',
    });

    expect(await claimAuditRecording(transactionId)).toBe(true);
    // Simulated failed audit write: never call markAuditRecorded, release instead.
    await releaseAuditRecordingLease(transactionId);

    expect(await claimAuditRecording(transactionId)).toBe(true);
    const row = await Transaction.findById(transactionId).lean();
    expect(row?.auditRecorded).not.toBe(true);
  });

  test('an unreleased lease — simulating a crash mid-write — becomes reclaimable once it expires', async () => {
    const { transactionId } = await applyIdempotentCredit({
      user: new mongoose.Types.ObjectId().toString(),
      incrementValue: 500,
      idempotencyKey: 'claim-key-5',
      context: 'admin',
    });

    expect(await claimAuditRecording(transactionId, 10)).toBe(true);
    // No release, no markAuditRecorded — simulates a crash while the write was in flight.
    expect(await claimAuditRecording(transactionId, 10)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await claimAuditRecording(transactionId, 10)).toBe(true);
  });
});

describe('findBalancesByUsers', () => {
  test('returns balances only for the requested users', async () => {
    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();
    const userC = new mongoose.Types.ObjectId();
    await Balance.create({ user: userA, tokenCredits: 100 });
    await Balance.create({ user: userB, tokenCredits: 200 });
    await Balance.create({ user: userC, tokenCredits: 300 });

    const results = await findBalancesByUsers([userA.toString(), userB.toString()]);

    expect(results).toHaveLength(2);
    const byUser = new Map(results.map((balance) => [balance.user.toString(), balance]));
    expect(byUser.get(userA.toString())?.tokenCredits).toBe(100);
    expect(byUser.get(userB.toString())?.tokenCredits).toBe(200);
    expect(byUser.has(userC.toString())).toBe(false);
  });

  test('returns an empty array for a user with no balance document', async () => {
    const userId = new mongoose.Types.ObjectId();
    const results = await findBalancesByUsers([userId.toString()]);
    expect(results).toEqual([]);
  });

  test('returns an empty array immediately for an empty input list', async () => {
    const results = await findBalancesByUsers([]);
    expect(results).toEqual([]);
  });
});

describe('createAutoRefillTransaction', () => {
  // The Balance schema defaults `lastRefill` to `Date.now` on creation — a
  // freshly-created document never actually has an absent `lastRefill`, so
  // every test here sets an explicit, known value and passes that exact
  // value through as `expectedLastRefill`, mirroring how a real caller
  // would pass through whatever it just read.
  const overdueLastRefill = new Date('2020-01-01T00:00:00.000Z');

  test('resolves a pending balance request for the same user, since the refill already addressed it', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });
    await balanceRequestMethods.createBalanceRequest(user.toString(), 'out of credits');

    await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      overdueLastRefill,
    );

    const stillPending = await balanceRequestMethods.findPendingBalanceRequestByUser(
      user.toString(),
    );
    expect(stillPending).toBeNull();
  });

  test('records the refilled amount on the resolved request, with no resolvedBy (system-resolved)', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });
    const request = await balanceRequestMethods.createBalanceRequest(user.toString(), 'reason');

    await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      overdueLastRefill,
    );

    const BalanceRequest = mongoose.models.BalanceRequest as mongoose.Model<IBalanceRequest>;
    const resolved = await BalanceRequest.findById(request._id).lean();
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAmount).toBe(1000);
    expect(resolved?.resolvedBy).toBeUndefined();
  });

  test("leaves a different user's pending request untouched", async () => {
    const user = new mongoose.Types.ObjectId();
    const otherUser = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });
    await balanceRequestMethods.createBalanceRequest(otherUser.toString(), 'reason');

    await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      overdueLastRefill,
    );

    const stillPending = await balanceRequestMethods.findPendingBalanceRequestByUser(
      otherUser.toString(),
    );
    expect(stillPending).not.toBeNull();
  });

  test('still applies the refill even when the user has no pending request', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });

    const result = await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      overdueLastRefill,
    );

    expect(result?.balance).toBe(1000);
  });

  test('only one of several concurrent calls for the same refill window succeeds — the rest lose the claim', async () => {
    // The exact race the review flagged: two callers both read the same
    // overdue `lastRefill` and both decide "eligible". Only one may
    // actually apply the refill; the other must detect it lost, not
    // blindly re-apply its own increment on retry.
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });

    const concurrency = 10;
    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        createAutoRefillTransaction(
          {
            user: user.toString(),
            tokenType: 'credits',
            context: 'autoRefill',
            rawAmount: 1000,
          },
          overdueLastRefill,
        ),
      ),
    );

    const applied = results.filter((r) => r != null);
    expect(applied).toHaveLength(1);

    const balance = await Balance.findOne({ user }).lean();
    expect(balance?.tokenCredits).toBe(1000);
  });

  test('a caller whose expectedLastRefill is already stale loses the claim without double-crediting', async () => {
    const user = new mongoose.Types.ObjectId();
    const originalLastRefill = new Date(Date.now() - 60 * 60 * 1000);
    await Balance.create({ user, tokenCredits: 0, lastRefill: originalLastRefill });

    // Someone else already claimed and applied this exact window.
    const first = await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      originalLastRefill,
    );
    expect(first?.balance).toBe(1000);

    // A second caller that read the balance *before* the first one
    // committed still has the stale `originalLastRefill` in hand.
    const second = await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      originalLastRefill,
    );
    expect(second).toBeUndefined();

    const balance = await Balance.findOne({ user }).lean();
    expect(balance?.tokenCredits).toBe(1000);
  });

  test('defers to an admin who already holds the pending request lease, applying no credit at all', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });
    const request = await balanceRequestMethods.createBalanceRequest(user.toString(), 'out');

    // Simulates exactly what `addCreditHandler` does before crediting —
    // claim the same lease auto-refill must now also respect.
    const adminClaimed = await balanceRequestMethods.claimBalanceRequestResolution(
      request._id.toString(),
      user.toString(),
    );
    expect(adminClaimed).toBe(true);

    const result = await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      overdueLastRefill,
    );

    expect(result).toBeUndefined();
    const balance = await Balance.findOne({ user }).lean();
    expect(balance?.tokenCredits).toBe(0);

    // The admin's own lease is untouched by the deferred attempt — their
    // claim is still live and they can still complete the resolution.
    const resolved = await balanceRequestMethods.resolveBalanceRequestIfPending(
      request._id.toString(),
      user.toString(),
      { resolvedBy: new mongoose.Types.ObjectId().toString(), resolvedAmount: 500 },
    );
    expect(resolved?.status).toBe('resolved');
  });

  test('releases the pending-request lease it claimed if it then loses the refill-window race', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });
    await balanceRequestMethods.createBalanceRequest(user.toString(), 'out');

    // A stale `expectedLastRefill` guarantees the refill-window claim below
    // is lost, isolating that failure path from the request-lease claim,
    // which must still succeed first.
    const staleLastRefill = new Date(overdueLastRefill.getTime() - 1000);
    const result = await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      staleLastRefill,
    );
    expect(result).toBeUndefined();

    // The lease must have been released, not left to expire — an admin
    // retrying immediately after should be able to claim it right away.
    const stillPending = await balanceRequestMethods.findPendingBalanceRequestByUser(
      user.toString(),
    );
    expect(stillPending).not.toBeNull();
    const adminClaimed = await balanceRequestMethods.claimBalanceRequestResolution(
      stillPending!._id.toString(),
      user.toString(),
    );
    expect(adminClaimed).toBe(true);
  });

  test('integration: an admin approval racing auto-refill results in exactly one fulfillment', async () => {
    const user = new mongoose.Types.ObjectId();
    await Balance.create({ user, tokenCredits: 0, lastRefill: overdueLastRefill });
    const request = await balanceRequestMethods.createBalanceRequest(user.toString(), 'out');

    // Admin's `addCreditHandler` claims the request first, exactly as it
    // does in production, before either side applies any credit.
    const adminClaimed = await balanceRequestMethods.claimBalanceRequestResolution(
      request._id.toString(),
      user.toString(),
    );
    expect(adminClaimed).toBe(true);

    // Auto-refill fires concurrently (e.g. a completion-token spend landing
    // the user at zero at the same moment) and must not also credit.
    const autoRefillResult = await createAutoRefillTransaction(
      {
        user: user.toString(),
        tokenType: 'credits',
        context: 'autoRefill',
        rawAmount: 1000,
      },
      overdueLastRefill,
    );
    expect(autoRefillResult).toBeUndefined();

    // The admin's credit (via `applyIdempotentCredit`, the real path
    // `addCreditHandler` uses) and resolution complete normally, holding
    // the lease it claimed the whole time.
    const credited = await applyIdempotentCredit({
      user: user.toString(),
      incrementValue: 500,
      idempotencyKey: `balance-request:${request._id.toString()}`,
      context: 'admin',
    });
    expect(credited.applied).toBe(true);
    const resolved = await balanceRequestMethods.resolveBalanceRequestIfPending(
      request._id.toString(),
      user.toString(),
      { resolvedBy: new mongoose.Types.ObjectId().toString(), resolvedAmount: 500 },
    );
    expect(resolved?.status).toBe('resolved');

    // Exactly one fulfillment landed — the admin's 500, not auto-refill's
    // 1000 on top of it.
    const finalBalance = await Balance.findOne({ user }).lean();
    expect(finalBalance?.tokenCredits).toBe(500);
  });
});
