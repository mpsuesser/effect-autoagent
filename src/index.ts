/**
 * effect-autoagent
 *
 * Meta-agent framework that autonomously iterates on an AI agent harness
 * by modifying prompts, tools, and orchestration, then hill-climbing on
 * benchmark scores.
 *
 * @since 0.1.0
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export {
	AgentRunError,
	BenchmarkError,
	ContainerError,
	EnvironmentError,
	ExperimentLogError,
	MetaAgentError,
	ShellExecError,
	TaskError,
	TrajectoryConversionError
} from './Errors.js';

// ---------------------------------------------------------------------------
// Domain Schemas
// ---------------------------------------------------------------------------
export {
	AgentInfo,
	AtifSchemaVersion,
	AtifStep,
	AtifTrajectory,
	FinalMetrics,
	Observation,
	ObservationResult,
	StepBuilder,
	ToolCall,
	buildTrajectory,
	ensureNonEmpty,
	stepSourceLabel,
	type StepSource
} from './Atif.js';

export { ExecResult } from './ExecResult.js';

export {
	ResponseUsage,
	UsageAccumulator,
	UsageSnapshot,
	empty as usageEmpty
} from './UsageMetrics.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export {
	AgentConfig,
	ThinkingConfig,
	ToolPreset,
	claudeDefault,
	openAiDefault
} from './AgentConfig.js';

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
export {
	BridgeExecResult,
	Environment,
	fromBridge,
	type BridgeOptions
} from './Environment.js';

export { runShell } from './ShellTool.js';

export { AgentConfigService, AgentRunner } from './AgentRunner.js';

// ---------------------------------------------------------------------------
// Trajectory Conversion
// ---------------------------------------------------------------------------
export {
	// OpenAI item types
	MessageItem,
	OpenAiItem,
	ReasoningItem,
	ToolCallItem,
	ToolCallOutputItem,
	type OpenAiConversionInput,
	fromOpenAiItems,
	// Claude message types
	ClaudeAssistantMessage,
	ClaudeContentBlock,
	ClaudeMessage,
	ClaudeResultMessage,
	ClaudeUsageStats,
	ClaudeUserMessage,
	TextBlock,
	ThinkingBlock,
	ToolResultBlock,
	ToolUseBlock,
	type ClaudeConversionInput,
	fromClaudeMessages
} from './TrajectoryConverter.js';

// ---------------------------------------------------------------------------
// Metrics + Trajectory Serialization
// ---------------------------------------------------------------------------
export {
	AgentMetrics,
	extractMetrics,
	formatSummary,
	trajectoryToJson,
	trajectoryToPlainObject
} from './Metrics.js';

// ---------------------------------------------------------------------------
// Agent Execution (Effect AI native)
// ---------------------------------------------------------------------------
export { AgentTools, AgentToolsLayer, RunShell } from './AgentToolkit.js';

export {
	AgentRunResult,
	ExitReason,
	type ExitReason as ExitReasonType
} from './AgentRunResult.js';

export {
	fromEffectAiHistory,
	type EffectAiConversionInput
} from './EffectAiConverter.js';

export { AgentExecutor } from './AgentExecutor.js';

// ---------------------------------------------------------------------------
// Provider Layers (bundled OpenAI + Anthropic)
// ---------------------------------------------------------------------------
export {
	AnthropicClientLayer,
	OpenAiClientLayer,
	anthropicModel,
	openAiModel
} from './Providers.js';

// ---------------------------------------------------------------------------
// Docker Container Management
// ---------------------------------------------------------------------------
export { BuildResult, ContainerManager } from './ContainerManager.js';

// ---------------------------------------------------------------------------
// Dockerfile Generation
// ---------------------------------------------------------------------------
export {
	DockerfileOptions,
	bunAgent,
	pythonBase
} from './DockerfileGenerator.js';

// ---------------------------------------------------------------------------
// Experiment Tracking
// ---------------------------------------------------------------------------
export {
	ExperimentLog,
	ExperimentRow,
	ExperimentStatus,
	type ExperimentStatus as ExperimentStatusType,
	rowFromTsv,
	rowToTsv
} from './ExperimentLog.js';

// ---------------------------------------------------------------------------
// Benchmark Orchestration
// ---------------------------------------------------------------------------
export {
	BenchmarkOptions,
	BenchmarkReport,
	BenchmarkRunner,
	TaskResult
} from './BenchmarkRunner.js';

// ---------------------------------------------------------------------------
// Harness Specification (meta-agent optimization surface)
// ---------------------------------------------------------------------------
export {
	DiagnosisOutput,
	EvaluationResult,
	FailureDiagnosis,
	HarnessManifest,
	type HarnessFile,
	ImprovementProposal,
	KeepDecision,
	type KeepDecision as KeepDecisionType,
	OptimizerState,
	defaultManifest,
	initialOptimizerState
} from './HarnessSpec.js';

// ---------------------------------------------------------------------------
// Task Specification
// ---------------------------------------------------------------------------
export {
	AgentSettings,
	EnvironmentSettings,
	TaskConfig,
	TaskMeta,
	TaskSpec,
	VerifierSettings,
	discoverTasks,
	parseTaskToml
} from './TaskSpec.js';

// ---------------------------------------------------------------------------
// Meta-Agent Optimizer
// ---------------------------------------------------------------------------
export { MetaAgent } from './MetaAgent.js';
