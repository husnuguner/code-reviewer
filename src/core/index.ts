/**
 * The public surface of the review core, for embedding the reviewer in a
 * larger application (a UI, a server) without going through the CLI.
 *
 * Everything here is free of I/O adapters: callers provide the ports.
 */

export type { ChangedFileEntry, ChangedFileRecord } from "./domain/changed-file";
export type { Finding } from "./domain/finding";
export type { Skill } from "./domain/skill";
export type { ChatMessage, ChatModel, ChatResponse } from "./ports/chat-model";
export type { ConsoleOutput } from "./ports/console";
export type { GitReader } from "./ports/git-reader";
export type { Logger } from "./ports/logger";
export { NULL_LOGGER } from "./ports/logger";
export type { SkillMatcher } from "./ports/skill-matcher";
export type {
  BranchReviewRecord,
  BranchReviewReporter,
  FindingRecord,
  PreviewReporter,
  SummaryRecord,
} from "./ports/review-reporter";
export type { SkillSource } from "./ports/skill-source";
export { Catalog, parseCatalog } from "./catalog/catalog";
export { initCatalog, listProjects } from "./catalog/commands";
export { type Config, ConfigError, buildConfig } from "./config/config";
export type { ConcurrencyLimits, FileReviewSettings, ReportPolicy } from "./config/settings";
export { DEFAULT_FILE_REVIEW_SETTINGS, DEFAULT_REPORT_POLICY } from "./config/settings";
export { resolveConfig } from "./config/resolver";
export { LLMProviderRegistry } from "./llm/provider-registry";
export type { LLMProvider, ProviderSettings } from "./llm/provider-registry";
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
// The scope decision, for a caller that wants to show or audit it without
// running a review.
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
export { CatalogError, GitError, ValueError, errorMessage } from "./util/errors";
