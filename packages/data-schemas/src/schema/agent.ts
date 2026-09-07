import { Schema } from 'mongoose';
import type { IAgent } from '~/types';

const agentSchema: Schema<IAgent> = new Schema<IAgent>(
  {
    id: {
      type: String,
      required: true,
    },
    name: {
      type: String,
    },
    description: {
      type: String,
    },
    instructions: {
      type: String,
    },
    avatar: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    provider: {
      type: String,
      required: true,
    },
    model: {
      type: String,
      required: true,
    },
    model_parameters: {
      type: Object,
    },
    artifacts: {
      type: String,
    },
    access_level: {
      type: Number,
    },
    recursion_limit: {
      type: Number,
    },
    eager_execution: {
      type: Boolean,
    },
    tools: {
      type: [String],
      default: undefined,
    },
    skills: {
      type: [String],
      default: undefined,
    },
    skills_enabled: {
      type: Boolean,
      default: undefined,
    },
    allow_other_skills: {
      type: Boolean,
      default: undefined,
    },
    tool_kwargs: {
      type: [{ type: Schema.Types.Mixed }],
    },
    actions: {
      type: [String],
      default: undefined,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    authorName: {
      type: String,
      default: undefined,
    },
    hide_sequential_outputs: {
      type: Boolean,
    },
    end_after_tools: {
      type: Boolean,
    },
    /** When true, hides the "Upload to Provider" file option and rejects
     *  provider-direct (no tool_resource) uploads for this agent. */
    disable_provider_upload: {
      type: Boolean,
      default: undefined,
    },
    /** When true, hides the "Upload as Text" (context) file option and rejects
     *  context (tool_resource: context) uploads for this agent. */
    disable_context_upload: {
      type: Boolean,
      default: undefined,
    },
    /** @deprecated Use edges instead */
    agent_ids: {
      type: [String],
    },
    edges: {
      type: [{ type: Schema.Types.Mixed }],
      default: [],
    },
    conversation_starters: {
      type: [String],
      default: [],
    },
    tool_resources: {
      type: Schema.Types.Mixed,
      default: {},
    },
    versions: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    category: {
      type: String,
      trim: true,
      index: true,
      default: 'general',
    },
    support_contact: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    is_promoted: {
      type: Boolean,
      default: false,
      index: true,
    },
    /** MCP server names extracted from tools for efficient querying */
    mcpServerNames: {
      type: [String],
      default: [],
      index: true,
    },
    /** Per-tool configuration (defer_loading, allowed_callers) */
    tool_options: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    /** Subagent spawning configuration — isolated-context child agents. */
    subagents: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    tenantId: {
      type: String,
      index: true,
    },
    /** Review/verification metadata */
    review_metadata: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

agentSchema.index({ id: 1, tenantId: 1 }, { unique: true });
agentSchema.index({ updatedAt: -1, _id: 1 });
agentSchema.index({ 'edges.to': 1 });

export default agentSchema;
