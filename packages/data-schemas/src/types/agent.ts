import { Document, Types } from 'mongoose';
import type { GraphEdge, AgentToolOptions } from 'librechat-data-provider';

export interface ISupportContact {
  name?: string;
  email?: string;
}

export interface IReviewEntry {
  _id?: Types.ObjectId;
  verified: boolean;
  comment: string;
  reviewed_by: Types.ObjectId;
  reviewed_by_name: string;
  reviewed_at: Date;
}

export interface IAgentReview extends Document {
  id: string;
  agent_id: string;
  /** Current verification status (can be reset by system when agent is updated) */
  verified: boolean;
  /** Timestamp of last verification status change */
  verified_at?: Date;
  reviews: IReviewEntry[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAgent extends Omit<Document, 'model'> {
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  avatar?: {
    filepath: string;
    source: string;
  };
  provider: string;
  model: string;
  model_parameters?: Record<string, unknown>;
  artifacts?: string;
  access_level?: number;
  recursion_limit?: number;
  tools?: string[];
  tool_kwargs?: Array<unknown>;
  actions?: string[];
  author: Types.ObjectId;
  authorName?: string;
  hide_sequential_outputs?: boolean;
  end_after_tools?: boolean;
  /** When true, hides the "Upload to Provider" file option and rejects
   *  provider-direct (no tool_resource) uploads for this agent. */
  disable_provider_upload?: boolean;
  /** @deprecated Use edges instead */
  agent_ids?: string[];
  edges?: GraphEdge[];
  /** @deprecated Use ACL permissions instead */
  isCollaborative?: boolean;
  conversation_starters?: string[];
  tool_resources?: unknown;
  projectIds?: Types.ObjectId[];
  versions?: Omit<IAgent, 'versions'>[];
  category: string;
  support_contact?: ISupportContact;
  is_promoted?: boolean;
  /** MCP server names extracted from tools for efficient querying */
  mcpServerNames?: string[];
  /** Per-tool configuration (defer_loading, allowed_callers) */
  tool_options?: AgentToolOptions;
}
