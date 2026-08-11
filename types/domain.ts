export type NodeStatus =
  | "pending"
  | "resolved";

export type MessageLocator = {
  version: 1;
  messageId?: string;
  turnId?: string;
  ordinal: number;
  fingerprint: string;
};

export type Project = {
  id: string;
  title: string;
  goal: string;
  focusNodeId?: string;
  createdAt: number;
  updatedAt: number;
};

export type QuestionNode = {
  id: string;
  projectId: string;
  parentId: string | null;
  question: string;
  summary: string;
  status: NodeStatus;
  chatId: string;
  messageId: string;
  messageAnchor?: string;
  messageLocator?: MessageLocator;
  createdAt: number;
  updatedAt: number;
};

export type ParentCandidate = {
  nodeId: string;
  confidence: number;
};

export type QuestionCandidate = {
  id: string;
  projectId: string;
  question: string;
  summary: string;
  chatId: string;
  messageId: string;
  messageAnchor?: string;
  messageLocator?: MessageLocator;
  recommendations: ParentCandidate[];
  noParentConfidence: number;
  status: "processing" | "inbox" | "failed";
  createdAt: number;
  updatedAt: number;
};

export type NodeEvent = {
  id: string;
  projectId: string;
  nodeId: string;
  type: "AUTO_LINK" | "CHANGE_PARENT";
  beforeParentId: string | null;
  afterParentId: string | null;
  source: "user" | "ai";
  confidence?: number;
  createdAt: number;
  undoneAt?: number;
};

export type ConversationMeta = {
  chatId: string;
  conversationUrl: string;
  conversationTitle?: string;
};

export type CapturedQuestion = {
  question: string;
  chatId: string;
  messageId: string;
  /** Ephemeral AI input. Repositories intentionally do not persist this field. */
  assistantContext?: string;
  messageAnchor?: string;
  messageLocator?: MessageLocator;
  conversationTitle?: string;
};

export type ParentRecommendationInput = {
  question: string;
  fallbackSummary: string;
  assistantContext?: string;
  currentPath: Array<Pick<QuestionNode, "id" | "question" | "summary">>;
  candidateNodes: Array<Pick<QuestionNode, "id" | "question" | "summary" | "status">>;
};

export type ParentRecommendation = {
  summary: string;
  candidates: ParentCandidate[];
  noParentConfidence: number;
  model?: string;
};

export type AIProviderId =
  | "bailian"
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "openrouter"
  | "custom-openai";

export type AITransport = "openai-chat" | "anthropic-messages";

export type AIProviderProfile = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type AIProviderDefinition = {
  id: AIProviderId;
  label: string;
  transport: AITransport;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: readonly string[];
  editableBaseUrl: boolean;
  supportsJsonResponseFormat: boolean;
  allowedHostname?: string;
  allowedHostnameSuffix?: string;
};

export type AISettings = {
  schemaVersion: 2;
  enabled: boolean;
  activeProvider: AIProviderId;
  profiles: Partial<Record<AIProviderId, AIProviderProfile>>;
  timeoutMs: number;
  highConfidence: number;
  mediumConfidence: number;
};
