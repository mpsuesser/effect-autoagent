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
// Tool Specification (declarative tool definitions)
// ---------------------------------------------------------------------------
export {
	FileListImpl,
	FileReadImpl,
	FileWriteImpl,
	HttpGetImpl,
	ParamSpec,
	ParamType,
	type ParamType as ParamTypeType,
	RunShellImpl,
	ShellCommandImpl,
	ToolImplementation,
	type ToolImplementation as ToolImplementationType,
	ToolSpec,
	defaultToolSpecs,
	isFileList,
	isFileRead,
	isFileWrite,
	isHttpGet,
	isRunShell,
	isShellCommand
} from './ToolSpec.js';

// ---------------------------------------------------------------------------
// Blueprint Patch (structured mutations)
// ---------------------------------------------------------------------------
export {
	AddTool,
	BlueprintPatch,
	type BlueprintPatch as BlueprintPatchType,
	ModifyTool,
	RemoveTool,
	SetConstraints,
	SetModel,
	SetOrchestration,
	SetSystemPrompt,
	applyPatches
} from './BlueprintPatch.js';

// ---------------------------------------------------------------------------
// Agent Blueprint
// ---------------------------------------------------------------------------
export {
	AgentBlueprint,
	AgentConstraints,
	BlueprintJson,
	ModelConfig,
	ModelProvider,
	ThinkingConfig as BlueprintThinkingConfig,
	decodeBlueprintJson,
	defaultBlueprint,
	encodeBlueprintJson
} from './AgentBlueprint.js';

export { BlueprintStore, BlueprintStoreError } from './BlueprintStore.js';

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

export { AgentFactory, AgentFactoryError } from './AgentFactory.js';

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
	BlueprintDiagnosisOutput,
	BlueprintProposal,
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
// Orchestration Strategy
// ---------------------------------------------------------------------------
export {
	FallbackModels,
	OrchestrationSpec,
	type OrchestrationSpec as OrchestrationSpecType,
	PlanAndExecute,
	SingleLoop,
	WithVerifier,
	defaultOrchestration,
	isFallbackModels,
	isPlanAndExecute,
	isSingleLoop,
	isWithVerifier,
	match as matchOrchestration
} from './OrchestrationSpec.js';

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
// Tool Factory
// ---------------------------------------------------------------------------
export {
	type BuiltToolkit,
	ToolFactory,
	ToolFactoryError
} from './ToolFactory.js';

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
export {
	AgentMcpLayer,
	AgentMcpStdioLayer,
	AgentMcpToolkit,
	BlueprintResource,
	GetBlueprint,
	RunTask
} from './AgentMcpServer.js';

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
export {
	AgentApi,
	AgentApiGroup,
	AgentApiHandlers,
	AgentHttpError,
	RunTaskMetrics,
	RunTaskPayload,
	RunTaskResponse
} from './AgentHttpApi.js';

// ---------------------------------------------------------------------------
// Meta-Agent Optimizer
// ---------------------------------------------------------------------------
export { MetaAgent } from './MetaAgent.js';
