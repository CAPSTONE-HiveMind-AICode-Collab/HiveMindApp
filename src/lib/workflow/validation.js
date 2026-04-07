import validationCore from "@/lib/workflow/validationCore.cjs";

export const {
  TASK_STATUSES,
  TASK_PRIORITIES,
  DECISION_STATUSES,
  cleanString,
  normalizeTaskStatus,
  normalizeTaskPriority,
  normalizeAssignees,
  normalizeBlockReason,
  normalizeDecisionStatus,
  normalizeSupersedesDecisionId,
} = validationCore;
