/**
 * Barrel for the session-recovery layer.
 *
 * RC-4 consolidated the `lib/recovery.ts` orchestration module into
 * `lib/recovery/hook.ts` alongside the existing storage / constants / types
 * submodules. This file exists to keep the public surface stable so every
 * consumer that imports from `./recovery` / `../lib/recovery` resolves exactly
 * as it did before the refactor.
 *
 * See `docs/audits/07-refactoring-plan.md#rc-4` and
 * `docs/audits/06-filesystem.md` for the motivation.
 */

// --- Types re-exported from the recovery/types module ----------------------
export type {
  MessageInfo,
  MessageData,
  MessagePart,
  RecoveryErrorType,
  ResumeConfig,
  ToolResultPart,
  ToolUsePart,
  ThinkingPartType,
  MetaPartType,
  ContentPartType,
  StoredMessageMeta,
  StoredTextPart,
  StoredToolPart,
  StoredReasoningPart,
  StoredStepPart,
  StoredPart,
} from "./recovery/types.js";

// --- Session recovery hook + detection + toast helpers ---------------------
export {
  detectErrorType,
  isRecoverableError,
  getRecoveryToastContent,
  getRecoverySuccessToast,
  getRecoveryFailureToast,
  createSessionRecoveryHook,
} from "./recovery/hook.js";
export type {
  SessionRecoveryHook,
  SessionRecoveryContext,
} from "./recovery/hook.js";
