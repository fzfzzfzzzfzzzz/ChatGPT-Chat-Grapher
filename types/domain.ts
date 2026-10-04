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

export type ReferenceLocator = {
  version: 1;
  chatId: string;
  role: "user" | "assistant";
  messageId?: string;
  turnId?: string;
  ordinal?: number;
  fingerprint?: string;
};

type QuestionReferenceBase = {
  id: string;
  sourceLocator?: ReferenceLocator;
};

export type FileQuestionReference = QuestionReferenceBase & {
  type: "file";
  name: string;
  mimeType?: string;
  size?: number;
};

export type ImageQuestionReference = QuestionReferenceBase & {
  type: "image";
  name?: string;
  alt?: string;
  thumbnailDataUrl?: string;
};

export type AssistantQuoteQuestionReference = QuestionReferenceBase & {
  type: "assistant_quote";
  excerpt: string;
};

export type QuestionReference =
  | FileQuestionReference
  | ImageQuestionReference
  | AssistantQuoteQuestionReference;

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
  /** Missing on legacy records and normalized to "captured" at read boundaries. */
  kind?: "captured" | "planned";
  plannedFromReviewId?: string;
  question: string;
  summary: string;
  status: NodeStatus;
  chatId: string;
  messageId: string;
  messageAnchor?: string;
  messageLocator?: MessageLocator;
  references?: QuestionReference[];
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
  references?: QuestionReference[];
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
  references?: QuestionReference[];
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

export type ReviewScopeType =
  | "current_branch"
  | "conversation"
  | "node_context";

export type ReviewEntrySource = "floating_panel" | "side_panel" | "node_menu";

export type ReviewModuleId =
  | "discussion_overview"
  | "user_goal"
  | "key_takeaways"
  | "consensus"
  | "user_decisions"
  | "unresolved_questions"
  | "missed_branches"
  | "user_confusions"
  | "next_steps"
  | "continuation_context"
  | "considered_options"
  | "disagreements"
  | "tradeoffs"
  | "rejected_or_deferred_options"
  | "assumptions_constraints"
  | "facts_to_verify"
  | "clarified_technical_details"
  | "understanding_changes"
  | "important_terms"
  | "prerequisite_gaps"
  | "product_problem"
  | "confirmed_scope"
  | "solution_architecture"
  | "technology_stack"
  | "business_technical_flow"
  | "data_interfaces_tools_skills"
  | "risks_dependencies"
  | "progress_release_plan"
  | "acceptance_criteria"
  | "external_confirmations"
  | "deliverables"
  | "branch_contribution"
  | "suggested_new_branches";

export type ReviewPresetId =
  | "general"
  | "technical_project"
  | "learning"
  | "decision"
  | "continue_conversation"
  | "custom";

export type ReviewClaimStatus =
  | "confirmed"
  | "user_decision"
  | "consensus"
  | "assistant_suggestion"
  | "tentative"
  | "unresolved"
  | "deferred"
  | "rejected";

export type ReviewEvidence = {
  id: string;
  sourceId: string;
  chatId: string;
  role: "user" | "assistant";
  excerpt: string;
  ordinal: number;
  locator: ReferenceLocator;
  nodeId?: string;
  branchPath?: string[];
};

export type ReviewItem = {
  id: string;
  text: string;
  status?: ReviewClaimStatus;
  isInference: boolean;
  /** Set locally when the user changes this item; independent from claim status/inference. */
  isUserEdited?: boolean;
  evidenceIds: string[];
};

export type ReviewBranchCandidate = {
  id: string;
  title: string;
  rationale: string;
  firstQuestion: string;
  sourceNodeId?: string;
};

export type ReviewModuleSnapshot = {
  overview: string;
  items: ReviewItem[];
  branchCandidates?: ReviewBranchCandidate[];
};

export type ReviewModuleState =
  | "queued"
  | "generating"
  | "completed"
  | "empty"
  | "failed";

export type ReviewModuleResult = {
  moduleId: ReviewModuleId;
  state: ReviewModuleState;
  generated: ReviewModuleSnapshot;
  current: ReviewModuleSnapshot;
  editHistory: ReviewModuleSnapshot[];
  editedAt?: number;
  error?: string;
};

/** Mutable portion accepted from the local editor. Generated snapshots and
 * module execution state are intentionally excluded. */
export type ReviewModuleEdit = Pick<
  ReviewModuleResult,
  "moduleId" | "current" | "editHistory" | "editedAt"
>;

export type ReviewScope = {
  type: ReviewScopeType;
  chatId: string;
  anchorNodeId?: string;
  rootNodeId?: string;
  nodeIds: string[];
  messageSourceIds: string[];
  messageCount: number;
  nodeCount: number;
  includesOtherBranches: boolean;
  completeness: "complete" | "partial";
  missingSourceIds: string[];
  estimatedTokens: number;
  sourceSnapshotHash: string;
};

export type ReviewDocument = {
  id: string;
  projectId: string;
  chatId: string;
  scopeFamilyKey: string;
  entrySource: ReviewEntrySource;
  activeVersionId?: string;
  graphAnchorNodeId?: string;
  supersedesDocumentId?: string;
  savedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type ReviewVersion = {
  id: string;
  documentId: string;
  projectId: string;
  version: number;
  title: string;
  scope: ReviewScope;
  moduleOrder: ReviewModuleId[];
  modules: ReviewModuleResult[];
  evidences: ReviewEvidence[];
  providerId?: AIProviderId;
  model?: string;
  segmented: boolean;
  segmentCount: number;
  missingRanges: string[];
  helpful?: boolean;
  moduleFeedback?: Partial<Record<ReviewModuleId, string>>;
  generatedAt: number;
  updatedAt: number;
};

export type ReviewJobStatus =
  | "waiting"
  | "collecting"
  | "organizing"
  | "generating"
  | "completed"
  | "partial"
  | "cancelled"
  | "failed"
  | "interrupted";

export type ReviewErrorCode =
  | "NOT_CONFIGURED"
  | "NOT_AUTHORIZED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "INVALID_RESPONSE"
  | "EMPTY_SCOPE"
  | "MISSING_RELATIONSHIP"
  | "STORAGE_FAILED"
  | "EXPORT_FAILED"
  | "CANCELLED"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_TOO_LARGE"
  | "INTERRUPTED";

export type ReviewJob = {
  id: string;
  projectId: string;
  documentId: string;
  scopeFamilyKey: string;
  scope: ReviewScope;
  selectedModuleIds: ReviewModuleId[];
  presetId: ReviewPresetId;
  status: ReviewJobStatus;
  progress: {
    current: number;
    total: number;
    message: string;
  };
  moduleStates: Partial<Record<ReviewModuleId, ReviewModuleState>>;
  errorCode?: ReviewErrorCode;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
};

/** Ephemeral source text. Never persist this shape in IndexedDB or backups. */
export type ConversationReviewMessage = {
  sourceId: string;
  chatId: string;
  role: "user" | "assistant";
  content: string;
  ordinal: number;
  locator: ReferenceLocator;
  nodeId?: string;
  branchPath?: string[];
};

export type ReviewCaptureReport = {
  chatId: string;
  conversationTitle?: string;
  messages: ConversationReviewMessage[];
  complete: boolean;
  missingSourceIds: string[];
  stoppedReason?: "scan_limit" | "virtualization_stalled" | "source_unavailable";
};
