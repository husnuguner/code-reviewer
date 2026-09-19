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
export type { Logger } from "./ports/logger";
export { NULL_LOGGER } from "./ports/logger";
export type { SkillMatcher } from "./ports/skill-matcher";
export type {
  BranchReviewRecord,
  BranchReviewReporter,
  FindingRecord,
  LineWriter,
  PreviewReporter,
  SummaryRecord,
  SummaryWriter,
} from "./ports/review-reporter";
export type { SkillSource } from "./ports/skill-source";
export { Catalog } from "./catalog/catalog";
export type { ProjectSettings, ProjectSpec } from "./catalog/catalog";
export { parseCatalog } from "./catalog/parse";
export { PROJECT_SETTING_KEYS, SCHEMA_VERSION } from "./catalog/schema";
export { initCatalog } from "./catalog/init";
export type { StarterFiles } from "./catalog/init";
export { addProject } from "./catalog/add-project";
export type { NewProject } from "./catalog/add-project";
export { listProjects } from "./catalog/list-projects";
export type { CatalogFiles, CatalogHome } from "./ports/catalog-files";
export { type Config, ConfigError, buildConfig } from "./config/config";
export type {
  ConcurrencyLimits,
  FileReviewSettings,
  LlmSettings,
  ReportPolicy,
} from "./config/settings";
export { DEFAULT_FILE_REVIEW_SETTINGS, DEFAULT_REPORT_POLICY } from "./config/settings";
export { resolveConfig } from "./config/resolver";
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
export { CatalogError, GitError, ValueError, errorMessage } from "./util/errors";
