const TASK_STATUSES = new Set(["todo", "doing", "blocked", "done"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);
const DECISION_STATUSES = new Set(["draft", "active", "superseded", "archived"]);

function cleanString(value, fallback = "") {
  const text =
    typeof value === "string"
      ? value
      : value === undefined || value === null
      ? ""
      : String(value);
  return text.trim() || fallback;
}

function normalizeTaskStatus(value) {
  const status = cleanString(value, "todo").toLowerCase();
  return TASK_STATUSES.has(status) ? status : "todo";
}

function normalizeTaskPriority(value) {
  const priority = cleanString(value, "medium").toLowerCase();
  return TASK_PRIORITIES.has(priority) ? priority : "medium";
}

function normalizeAssignees(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item)).filter(Boolean))];
}

function normalizeBlockReason(status, blockReason = "") {
  return normalizeTaskStatus(status) === "blocked" ? cleanString(blockReason) : "";
}

function normalizeDecisionStatus(value) {
  const status = cleanString(value, "draft").toLowerCase();
  return DECISION_STATUSES.has(status) ? status : "draft";
}

function normalizeSupersedesDecisionId(decisionID, supersedesDecisionId = "") {
  const currentId = cleanString(decisionID);
  const targetId = cleanString(supersedesDecisionId);
  if (!currentId || !targetId || currentId === targetId) return "";
  return targetId;
}

module.exports = {
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
};
