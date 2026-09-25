/**
 * The public surface of the review core, for embedding. Callers provide the ports.
 * @packageDocumentation
 */

export type { ChangedFileEntry, ChangedFileRecord } from "./domain/changed-file";
export type { Finding } from "./domain/finding";
export type { Skill } from "./domain/skill";
export type { ChatMessage, ChatModel, ChatResponse } from "./ports/chat-model";
export type { ConsoleOutput } from "./ports/console";
export { PostingError } from "./ports/review-poster";
export type {
  PostingResult,
  ReviewEvent,
  ReviewPoster,
  ReviewSubmission,
} from "./ports/review-poster";
export type { GitReader } from "./ports/git-reader";
export type {
  ExportSyntax,
  FileNaming,
  ImportSyntax,
  LanguageLookup,
  LanguageSupport,
  ModuleResolution,
  ModuleSurface,
  ModuleTarget,
  PatchSides,
  UsageScope,
} from "./ports/language";
export {
  NO_LANGUAGES,
  PLAIN_TEXT,
  changedSymbols,
  defaultStem,
  directoryOf,
  extensionOf,
  fileNameOf,
  gatherContext,
  isSourceLikePath,
  joinRelative,
  patchSides,
  renderContext,
} from "./review/context/index";
export type { ContextLimits, GatherContextOptions, ReviewContext } from "./review/context/index";
export type { Logger } from "./ports/logger";
export { NULL_LOGGER } from "./ports/logger";
export type { SkillMatcher } from "./ports/skill-matcher";
export type {
  BranchReviewRecord,
  BranchReviewReporter,
  BypassRegionRecord,
  FindingRecord,
  LineWriter,
  PreviewReporter,
  SummaryRecord,
  SummaryWriter,
} from "./ports/review-reporter";
export type { SkillSource } from "./ports/skill-source";
export type { ConfigFile, SettingValues } from "./config/config-file";
export { parseConfigFile } from "./config/parse";
export { REPO_ONLY_KEYS, SCHEMA_VERSION, SETTINGS_SECTION_KEYS } from "./config/schema";
export type { ConfigShape } from "./config/schema";
export { initConfigFile } from "./config/init";
export type { StarterFiles } from "./config/init";
export type { ConfigDirectory, ConfigHome } from "./ports/config-directory";
export { type Config, ConfigError, buildConfig } from "./config/config";
export type {
  ConcurrencyLimits,
  FileReviewSettings,
  LlmSettings,
  ReportPolicy,
} from "./config/settings";
export { DEFAULT_FILE_REVIEW_SETTINGS, DEFAULT_REPORT_POLICY } from "./config/settings";
export {
  branchReviewText,
  iterBranchReview,
  previewBranch,
  reviewBranch,
  streamBranchReview,
} from "./review/branch-review";
export type {
  BranchPreviewOptions,
  BranchReviewOptions,
  BranchReviewResult,
} from "./review/branch-review";
export { FileReviewer } from "./review/file-reviewer";
export { capPerFile } from "./review/volume";
export {
  decideFile,
  isSelected,
  selectFiles,
  selectedFiles,
  skipCounts,
  skipDetail,
  skippedFiles,
} from "./review/selection";
export type {
  FileDecision,
  SelectedFile,
  SelectionReason,
  SkipReason,
  SkippedFile,
} from "./review/selection";
export { SEVERITIES } from "./review/severity";
export type { Severity } from "./review/severity";
export { FrontmatterSkillParser } from "./skills/parser";
export { SkillRegistry } from "./skills/registry";
export { ConfigFileError, GitError, ValueError, errorMessage } from "./util/errors";
