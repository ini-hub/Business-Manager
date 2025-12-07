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
  }

  logAuthAttempt(userId: string | undefined, ip: string | undefined, success: boolean): void {
    this.log({
      action: "AUTH_ATTEMPT",
      resource: "session",
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
