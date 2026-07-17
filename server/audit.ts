import { db } from "./db";
import { auditLogs } from "@shared/schema";
import type { AuditContext } from "./routes/helpers";

interface AuditLogEntry {
  timestamp: string;
  action: string;
  resource: string;
  resourceId?: string;
  userId?: string;
  ip?: string;
  details?: Record<string, unknown>;
  status: "success" | "failure";
  errorMessage?: string;

  // Actor identity, scoping, diff, origin, correlation — see AuditContext.
  actorRole?: string;
  actorName?: string;
  actorEmail?: string;
  businessId?: string;
  storeId?: string;
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  changedFields?: string[];
  userAgent?: string;
  channel?: string;
  batchId?: string;
}

class AuditLogger {
  private formatEntry(entry: AuditLogEntry): string {
    const parts = [
      `[${entry.timestamp}]`,
      `[${entry.status.toUpperCase()}]`,
      `[${entry.action}]`,
      `[${entry.resource}]`,
    ];
    if (entry.resourceId) parts.push(`[id:${entry.resourceId}]`);
    if (entry.userId) parts.push(`[user:${entry.userId}]`);
    if (entry.ip) parts.push(`[ip:${entry.ip}]`);
    if (entry.errorMessage) parts.push(`[error:${entry.errorMessage}]`);
    return parts.join(" ");
  }

  log(entry: Omit<AuditLogEntry, "timestamp">): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    if (entry.status === "failure") {
      console.error("AUDIT:", this.formatEntry(fullEntry));
    } else {
      console.log("AUDIT:", this.formatEntry(fullEntry));
    }

    // Persist to DB — fire-and-forget; never block the request
    db.insert(auditLogs).values({
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
      userId: entry.userId,
      ip: entry.ip,
      status: entry.status,
      errorMessage: entry.errorMessage,
      details: entry.details as any,
      actorRole: entry.actorRole,
      actorName: entry.actorName,
      actorEmail: entry.actorEmail,
      businessId: entry.businessId,
      storeId: entry.storeId,
      previousValues: entry.previousValues as any,
      newValues: entry.newValues as any,
      changedFields: entry.changedFields,
      userAgent: entry.userAgent,
      channel: entry.channel ?? "web",
      batchId: entry.batchId,
    }).catch((err) => {
      console.error("[AuditLogger] DB write failed:", err);
    });
  }

  /**
   * Preferred entry point for domain-specific, non-CRUD transitions (approvals,
   * recoveries, security events) — takes an AuditContext built via
   * getAuditContext() so actor/origin/scoping are always populated consistently
   * with the generic *WithAudit() repository capture path.
   */
  logEvent(
    ctx: AuditContext,
    action: string,
    resource: string,
    resourceId: string | undefined,
    status: "success" | "failure",
    opts: {
      previousValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
      changedFields?: string[];
      details?: Record<string, unknown>;
      errorMessage?: string;
    } = {}
  ): void {
    this.log({
      action,
      resource,
      resourceId,
      userId: ctx.userId,
      ip: ctx.ip,
      status,
      errorMessage: opts.errorMessage,
      details: opts.details,
      actorRole: ctx.role,
      actorName: ctx.name,
      actorEmail: ctx.email,
      businessId: ctx.businessId,
      storeId: ctx.storeId,
      previousValues: opts.previousValues,
      newValues: opts.newValues,
      changedFields: opts.changedFields,
      userAgent: ctx.userAgent,
      channel: ctx.channel,
      batchId: ctx.batchId,
    });
  }

  logAuthAttempt(userId: string | undefined, ip: string | undefined, success: boolean, authType?: string): void {
    this.log({
      action: "AUTH_ATTEMPT",
      resource: authType || "session",
      userId,
      ip,
      status: success ? "success" : "failure",
    });
  }

  logDataAccess(resource: string, resourceId: string | undefined, userId: string | undefined, action: string): void {
    this.log({
      action,
      resource,
      resourceId,
      userId,
      status: "success",
    });
  }

  logDataModification(
    resource: string,
    resourceId: string | undefined,
    userId: string | undefined,
    action: string,
    success: boolean,
    errorMessage?: string
  ): void {
    this.log({
      action,
      resource,
      resourceId,
      userId,
      status: success ? "success" : "failure",
      errorMessage,
    });
  }

  logSecurityEvent(event: string, userId: string | undefined, ip: string | undefined, details?: Record<string, unknown>): void {
    this.log({
      action: "SECURITY_EVENT",
      resource: event,
      userId,
      ip,
      details,
      status: "success",
    });
  }

  logPayment(
    checkoutId: string,
    customerId: string,
    amount: number,
    method: string,
    status: "success" | "failure",
    errorMessage?: string
  ): void {
    this.log({
      action: "PAYMENT",
      resource: "checkout",
      resourceId: checkoutId,
      details: { customerId, amount, method },
      status,
      errorMessage,
    });
  }
}

export const auditLogger = new AuditLogger();
