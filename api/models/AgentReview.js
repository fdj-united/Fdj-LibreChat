const mongoose = require('mongoose');
const { nanoid } = require('nanoid');

const reviewSchema = new mongoose.Schema(
  {
    verified: {
      type: Boolean,
      default: false,
    },
    comment: {
      type: String,
      default: '',
    },
    reviewed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    reviewed_by_name: {
      type: String,
      required: true,
    },
    reviewed_at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true },
);

const agentReviewSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
    },
    agent_id: {
      type: String,
      required: true,
      index: true,
    },
    reviews: [reviewSchema],
  },
  {
    timestamps: true,
  },
);

// Create a unique index on agent_id to ensure one review document per agent
agentReviewSchema.index({ agent_id: 1 }, { unique: true });

const AgentReview = mongoose.model('AgentReview', agentReviewSchema);

/**
 * Get agent review by agent ID
 * @param {string} agentId - The agent ID
 * @returns {Promise<Object|null>} The agent review document or null
 */
async function getAgentReview(agentId) {
  return await AgentReview.findOne({ agent_id: agentId }).lean();
}

/**
 * Create or update agent review
 * @param {string} agentId - The agent ID
 * @param {Object} reviewData - The review data
 * @param {boolean} reviewData.verified - Verification status
 * @param {string} reviewData.comment - Review comment
 * @param {string} reviewData.reviewed_by - User ID of reviewer
 * @param {string} reviewData.reviewed_by_name - Name of reviewer
 * @returns {Promise<Object>} The updated agent review document
 */
async function addOrUpdateReview(agentId, reviewData) {
  const { verified, comment, reviewed_by, reviewed_by_name } = reviewData;

  const newReview = {
    verified,
    comment: comment || '',
    reviewed_by: new mongoose.Types.ObjectId(reviewed_by),
    reviewed_by_name,
    reviewed_at: new Date(),
  };

  // Find existing review document or create new one
  let agentReview = await AgentReview.findOne({ agent_id: agentId });

  if (!agentReview) {
    // Create new review document
    agentReview = new AgentReview({
      id: `review_${nanoid()}`,
      agent_id: agentId,
      reviews: [newReview],
    });
  } else {
    // Add new review to the reviews array
    agentReview.reviews.push(newReview);
  }

  await agentReview.save();
  return agentReview.toObject();
}

/**
 * Get the latest review for an agent
 * @param {string} agentId - The agent ID
 * @returns {Promise<Object|null>} The latest review or null
 */
async function getLatestReview(agentId) {
  const agentReview = await AgentReview.findOne({ agent_id: agentId }).lean();

  if (!agentReview || !agentReview.reviews || agentReview.reviews.length === 0) {
    return null;
  }

  // Return the most recent review (last in array)
  return agentReview.reviews[agentReview.reviews.length - 1];
}

/**
 * Get all reviews for an agent
 * @param {string} agentId - The agent ID
 * @returns {Promise<Array>} Array of reviews
 */
async function getAllReviews(agentId) {
  const agentReview = await AgentReview.findOne({ agent_id: agentId }).lean();

  if (!agentReview || !agentReview.reviews) {
    return [];
  }

  return agentReview.reviews;
}

/**
 * Delete a single review entry by its _id
 * @param {string} agentId - The agent ID
 * @param {string} reviewId - The review subdocument _id (string or ObjectId)
 * @returns {Promise<Object|null>} The updated document or null if agent or review not found
 */
async function deleteReview(agentId, reviewId) {
  const doc = await AgentReview.findOne({ agent_id: agentId }).lean();
  if (!doc || !doc.reviews?.length) {
    return null;
  }
  const hasReview = doc.reviews.some((r) => r._id?.toString() === reviewId);
  if (!hasReview) {
    return null;
  }
  const id = mongoose.Types.ObjectId.isValid(reviewId) ? new mongoose.Types.ObjectId(reviewId) : reviewId;
  const result = await AgentReview.findOneAndUpdate(
    { agent_id: agentId },
    { $pull: { reviews: { _id: id } } },
    { new: true },
  ).lean();
  return result;
}

/**
 * Delete all reviews for an agent
 * @param {string} agentId - The agent ID
 * @returns {Promise<Object|null>} The deleted document or null
 */
async function deleteAgentReviews(agentId) {
  return await AgentReview.findOneAndDelete({ agent_id: agentId });
}

module.exports = {
  AgentReview,
  getAgentReview,
  addOrUpdateReview,
  getLatestReview,
  getAllReviews,
  deleteReview,
  deleteAgentReviews,
};
