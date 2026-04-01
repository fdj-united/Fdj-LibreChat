const express = require('express');
const { generateCheckAccess, checkAccess } = require('@librechat/api');
const { PermissionTypes, Permissions, PermissionBits, SystemRoles } = require('librechat-data-provider');
const { requireJwtAuth, configMiddleware, canAccessAgentResource } = require('~/server/middleware');
const { getAgent } = require('~/models/Agent');
const {
  addOrUpdateReview,
  getAgentReview,
  getLatestReview,
  getAllReviews,
  deleteReview,
} = require('~/models/AgentReview');
const v1 = require('~/server/controllers/agents/v1');
const { getRoleByName } = require('~/models');
const actions = require('./actions');
const tools = require('./tools');

const router = express.Router();
const avatar = express.Router();

const checkAgentAccess = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE],
  getRoleByName,
});
const checkAgentCreate = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE, Permissions.CREATE],
  getRoleByName,
});

router.use(requireJwtAuth);

const requireMarketplaceVerification = (req, res, next) => {
  if (req.config?.interfaceConfig?.marketplace?.verification === false) {
    return res.status(403).json({ error: 'Marketplace agent verification is disabled' });
  }
  next();
};

/**
 * Agent actions route.
 * @route GET|POST /agents/actions
 */
router.use('/actions', configMiddleware, actions);

/**
 * Get a list of available tools for agents.
 * @route GET /agents/tools
 */
router.use('/tools', configMiddleware, tools);

/**
 * Get all agent categories with counts
 * @route GET /agents/categories
 */
router.get('/categories', v1.getAgentCategories);
/**
 * Creates an agent.
 * @route POST /agents
 * @param {AgentCreateParams} req.body - The agent creation parameters.
 * @returns {Agent} 201 - Success response - application/json
 */
router.post('/', checkAgentCreate, v1.createAgent);

/**
 * Retrieves basic agent information (VIEW permission required).
 * Returns safe, non-sensitive agent data for viewing purposes.
 * @route GET /agents/:id
 * @param {string} req.params.id - Agent identifier.
 * @returns {Agent} 200 - Basic agent info - application/json
 */
router.get(
  '/:id',
  checkAgentAccess,
  canAccessAgentResource({
    requiredPermission: PermissionBits.VIEW,
    resourceIdParam: 'id',
  }),
  v1.getAgent,
);

/**
 * Retrieves full agent details including sensitive configuration (EDIT permission required).
 * Returns complete agent data for editing/configuration purposes.
 * @route GET /agents/:id/expanded
 * @param {string} req.params.id - Agent identifier.
 * @returns {Agent} 200 - Full agent details - application/json
 */
router.get(
  '/:id/expanded',
  checkAgentAccess,
  canAccessAgentResource({
    requiredPermission: PermissionBits.EDIT,
    resourceIdParam: 'id',
  }),
  (req, res) => v1.getAgent(req, res, true), // Expanded version
);
/**
 * Updates an agent.
 * @route PATCH /agents/:id
 * @param {string} req.params.id - Agent identifier.
 * @param {AgentUpdateParams} req.body - The agent update parameters.
 * @returns {Agent} 200 - Success response - application/json
 */
router.patch(
  '/:id',
  checkAgentCreate,
  canAccessAgentResource({
    requiredPermission: PermissionBits.EDIT,
    resourceIdParam: 'id',
  }),
  v1.updateAgent,
);

/**
 * Duplicates an agent.
 * @route POST /agents/:id/duplicate
 * @param {string} req.params.id - Agent identifier.
 * @returns {Agent} 201 - Success response - application/json
 */
router.post(
  '/:id/duplicate',
  checkAgentCreate,
  canAccessAgentResource({
    requiredPermission: PermissionBits.EDIT,
    resourceIdParam: 'id',
  }),
  v1.duplicateAgent,
);

/**
 * Deletes an agent.
 * @route DELETE /agents/:id
 * @param {string} req.params.id - Agent identifier.
 * @returns {Agent} 200 - success response - application/json
 */
router.delete(
  '/:id',
  checkAgentCreate,
  canAccessAgentResource({
    requiredPermission: PermissionBits.DELETE,
    resourceIdParam: 'id',
  }),
  v1.deleteAgent,
);

/**
 * Reverts an agent to a previous version.
 * @route POST /agents/:id/revert
 * @param {string} req.params.id - Agent identifier.
 * @param {number} req.body.version_index - Index of the version to revert to.
 * @returns {Agent} 200 - success response - application/json
 */
router.post(
  '/:id/revert',
  checkAgentCreate,
  canAccessAgentResource({
    requiredPermission: PermissionBits.EDIT,
    resourceIdParam: 'id',
  }),
  v1.revertAgentVersion,
);

/**
 * Gets the latest review for an agent.
 * @route GET /agents/:id/review
 * @param {string} req.params.id - Agent identifier.
 * @returns {Object} 200 - Latest review or null - application/json
 */
router.get('/:id/review', configMiddleware, requireMarketplaceVerification, async (req, res) => {
  try {
    const { id } = req.params;
    const existingAgent = await getAgent({ id });
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const latestReview = await getLatestReview(id);
    return res.json(latestReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Gets all reviews for an agent.
 * @route GET /agents/:id/reviews
 * @param {string} req.params.id - Agent identifier.
 * @returns {Array} 200 - Array of reviews - application/json
 */
router.get('/:id/reviews', configMiddleware, requireMarketplaceVerification, async (req, res) => {
  try {
    const { id } = req.params;
    const existingAgent = await getAgent({ id });
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const reviews = await getAllReviews(id);
    return res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Adds a review for an agent.
 * @route POST /agents/:id/review
 * @param {string} req.params.id - Agent identifier.
 * @param {boolean} req.body.verified - Verification status.
 * @param {string} req.body.comment - Review comment.
 * @returns {Object} 200 - The new review - application/json
 */
router.post('/:id/review', configMiddleware, requireMarketplaceVerification, async (req, res) => {
  try {
    const { id } = req.params;
    const { verified, comment } = req.body;
    const existingAgent = await getAgent({ id });
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const isAdmin = req.user?.role === SystemRoles.ADMIN;
    const canUseMarketplace = await checkAccess({
      req,
      user: req.user,
      permissionType: PermissionTypes.MARKETPLACE,
      permissions: [Permissions.USE],
      getRoleByName,
    });
    const canManageVerification = isAdmin && canUseMarketplace;
    let verifiedStatus = !!verified;
    if (!canManageVerification) {
      const latestReview = await getLatestReview(id);
      verifiedStatus = latestReview?.verified ?? false;
    }

    const reviewData = {
      verified: verifiedStatus,
      comment: comment || '',
      reviewed_by: req.user.id,
      reviewed_by_name: req.user.name || req.user.username || req.user.email,
    };
    const agentReview = await addOrUpdateReview(id, reviewData);
    // Return the latest review
    const latestReview = agentReview.reviews[agentReview.reviews.length - 1];
    return res.json(latestReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Deletes a single review entry for an agent.
 * @route DELETE /agents/:id/reviews/:reviewId
 * @param {string} req.params.id - Agent identifier.
 * @param {string} req.params.reviewId - Review subdocument _id.
 * @returns {void} 204 - No content
 */
router.delete(
  '/:id/reviews/:reviewId',
  configMiddleware,
  requireMarketplaceVerification,
  async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const existingAgent = await getAgent({ id });
    if (!existingAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    const agentReview = await getAgentReview(id);
    if (!agentReview?.reviews?.length) {
      return res.status(404).json({ error: 'Agent review not found' });
    }
    const entry = agentReview.reviews.find((r) => r._id?.toString() === reviewId);
    if (!entry) {
      return res.status(404).json({ error: 'Review not found' });
    }
    const isAuthor = entry.reviewed_by?.toString() === req.user.id;
    if (!isAuthor) {
      const canManageReviews = await checkAccess({
        req,
        user: req.user,
        permissionType: PermissionTypes.MARKETPLACE,
        permissions: [Permissions.USE],
        getRoleByName,
      });
      if (!canManageReviews) {
        return res.status(403).json({ error: 'You can only delete your own comment' });
      }
    }
    const updated = await deleteReview(id, reviewId);
    if (!updated) {
      return res.status(404).json({ error: 'Agent review not found' });
    }
    return res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
  },
);

/**
 * Returns a list of agents.
 * @route GET /agents
 * @param {AgentListParams} req.query - The agent list parameters for pagination and sorting.
 * @returns {AgentListResponse} 200 - success response - application/json
 */
router.get('/', checkAgentAccess, v1.getListAgents);

/**
 * Uploads and updates an avatar for a specific agent.
 * @route POST /agents/:agent_id/avatar
 * @param {string} req.params.agent_id - The ID of the agent.
 * @param {Express.Multer.File} req.file - The avatar image file.
 * @param {string} [req.body.metadata] - Optional metadata for the agent's avatar.
 * @returns {Object} 200 - success response - application/json
 */
avatar.post(
  '/:agent_id/avatar/',
  checkAgentAccess,
  canAccessAgentResource({
    requiredPermission: PermissionBits.EDIT,
    resourceIdParam: 'agent_id',
  }),
  v1.uploadAgentAvatar,
);

module.exports = { v1: router, avatar };
