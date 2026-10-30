import { AsyncLocalStorage } from "node:async_hooks";

// Carries authenticated device identity across async service calls.
// PostgreSQL transaction-local settings reset automatically at commit/rollback.
export const requestContext = new AsyncLocalStorage();
