import { recordSyncConflict } from "../services/conflicts.js";

export async function errorHandler(error, req, res, _next) {
  if (res.headersSent) return _next(error);
  if (error instanceof SyntaxError && "body" in error)
    return res.status(400).json({ error: "Invalid JSON" });
  if (error.code === "23505" || error.code === "23503")
    return res.status(409).json({ error: "Conflicting or missing reference" });
  if (["57014", "55P03", "53300"].includes(error.code))
    return res
      .status(503)
      .json({ error: "Database busy; retry later", outcome: "retryable" });
  if (error.status) {
    try {
      const conflictId = await recordSyncConflict(error, req);
      if (conflictId)
        return res.status(409).json({
          error: error.message,
          outcome: "review_required",
          conflictId,
        });
    } catch (recordError) {
      if (recordError.status === 409)
        return res
          .status(409)
          .json({ error: recordError.message, outcome: "permanent" });
      console.error(
        "Conflict recording failed:",
        recordError.code || "database_error",
      );
      return res.status(503).json({
        error: "Conflict could not be saved; retry later",
        outcome: "retryable",
      });
    }
    return res.status(error.status).json({ error: error.message });
  }
  console.error("API request failed:", {
    code: error.code || "internal_error",
    method: req.method,
    path: req.path,
  });
  res.status(500).json({ error: "Internal server error" });
}
