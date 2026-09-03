import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import {
  insertBusinessSchema,
  insertStoreSchema,
  insertCustomerSchema,
  insertStaffSchema,
  insertInventorySchema,
  insertPromotionSchema,
  insertCustomRoleSchema,
  insertStoreIntegrationSchema,
  insertExpenseSchema,
  type UserRole,
  orders,
  checkouts,
  promotions,
  transactions,
  customers,
  inventory,
  staff,
  customRoles,
  taxRates,
  repayments,
  expenses,
  cashDrops,
  creditEntries,
  cashRegisterSessions,
} from "@shared/schema";
import { z } from "zod";
import { db } from "../db";
import { eq, and, gte, lte, gt, count, desc } from "drizzle-orm";
import { sanitizeString, sanitizeUUID, sanitizeNumber, sanitizeBoolean, sanitizePhoneNumber, sanitizeStoreCode } from "../sanitize";
import { isValidLatitude, isValidLongitude } from "@shared/geo";
import { getOrgEntitlements, getFeatureByKey } from "../lib/entitlements";

// Settings fields gated behind a purchasable feature (§1 of the pay-per-
// feature plan) - everything else in PUT /api/settings' payload (attendance,
// payroll splits, borrow-book reminders, ...) stays free. Checked as whole
// field groups so a request either fully applies or is rejected outright -
// never a silent partial write of only the fields the org happens to own.
const GATED_SETTINGS_FIELDS: Record<string, string> = {
  receiptPrefix: "receipt_customization",
  receiptThankYouMessage: "receipt_customization",
  lowStockThreshold: "low_stock_threshold",
  loyaltyPointsPerCurrency: "loyalty_program",
  loyaltyPointValue: "loyalty_program",
};

const clampInt = (value: unknown, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(sanitizeNumber(value))));

/** Unique weekday numbers, 0 = Sunday, sorted. Anything else is discarded. */
const normaliseWeekdays = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const days = value
    .map(d => Math.round(Number(d)))
    .filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  return Array.from(new Set(days)).sort((a, b) => a - b);
};

/** Returns a message for anything that must be refused outright, else null. */
const validateAttendanceSettings = (body: any): string | null => {
  if (body.openingTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.openingTime).trim())) {
    return "Opening time must be in HH:MM format (24-hour), e.g. 09:00.";
  }

  const latGiven = body.geofenceLatitude !== undefined && body.geofenceLatitude !== null;
  const lngGiven = body.geofenceLongitude !== undefined && body.geofenceLongitude !== null;
  if (latGiven !== lngGiven && (body.geofenceLatitude !== undefined || body.geofenceLongitude !== undefined)) {
    return "Set both latitude and longitude for the branch location, or clear both.";
  }
  if (latGiven && !isValidLatitude(Number(body.geofenceLatitude))) {
    return "Latitude must be between -90 and 90.";
  }
  if (lngGiven && !isValidLongitude(Number(body.geofenceLongitude))) {
    return "Longitude must be between -180 and 180.";
  }
  return null;
};
import { auditLogger } from "../audit";
import { bulkUploadService } from "../services/BulkUploadService";
import { analyticsService } from "../services/AnalyticsService";
import { getUserId, getClientIp, formatZodErrors, checkBusinessAccess, getUserStores, verifyStoreAccess, verifyRecordStoreAccess, triggerAutoRecalculate } from './helpers';

export type RouteMiddlewares = {
  isAuthenticated: any;
  requireRole: (...roles: any[]) => any;
  requireManagerOrOwner: any;
  checkStoreAccess: (storeId: string, req: Request, res: Response) => Promise<boolean>;
};

export function registerSettingsRoutes(app: Express, { isAuthenticated, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== SETTINGS ==========
  app.get("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });

      if (storeId === "all") {
        const businessId = (req as any).user?.businessId || (req as any).user?.organisationId;
        if (!businessId) return res.status(400).json({ error: "Business ID required." });
        if (!(await checkBusinessAccess(businessId, req, res))) return;

        const business = await storage.getBusinessById(businessId);
        const storesList = await storage.getStores(businessId);
        let firstStoreSettings = null;
        if (storesList.length > 0) {
          firstStoreSettings = await storage.getSettings(storesList[0].id);
        }

        return res.json({
          id: "all",
          storeId: "all",
          receiptPrefix: business?.receiptPrefix || "RCP",
          receiptThankYouMessage: firstStoreSettings?.receiptThankYouMessage || "",
          lowStockThreshold: firstStoreSettings?.lowStockThreshold ?? 5,
        });
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;
      const settings = await storage.getSettings(storeId);
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: "Could not load settings." });
    }
  });

  app.put("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const { storeId, ...data } = req.body;
      if (!storeId) return res.status(400).json({ error: "storeId is required." });

      // Only owner/manager can edit settings
      const role = (req as any).user?.role;
      if (role !== "manager" && role !== "owner") {
        return res.status(403).json({ error: "Only managers and owners can modify settings." });
      }

      const businessId = (req as any).user?.businessId;
      const neededFeatureKeys = new Set(Object.keys(data).map((field) => GATED_SETTINGS_FIELDS[field]).filter(Boolean));
      if (neededFeatureKeys.size > 0) {
        if (!businessId) return res.status(401).json({ error: "Authentication required." });
        const granted = await getOrgEntitlements(businessId);
        for (const featureKey of Array.from(neededFeatureKeys)) {
          if (!granted.has(featureKey)) {
            const feature = await getFeatureByKey(featureKey);
            return res.status(402).json({
              error: "feature_not_purchased",
              featureKey,
              message: `This needs the "${feature?.name ?? featureKey}" add-on. Add it from Settings > Billing to continue.`,
            });
          }
        }
      }

      const sanitizeSettings = (body: any) => {
        const sanitized: any = {};
        if (body.defaultPaymentMethod !== undefined) sanitized.defaultPaymentMethod = sanitizeString(body.defaultPaymentMethod);
        if (body.commissionType !== undefined) sanitized.commissionType = sanitizeString(body.commissionType);
        if (body.commissionFixedAmount !== undefined) sanitized.commissionFixedAmount = sanitizeNumber(body.commissionFixedAmount);
        if (body.commissionFormula !== undefined) sanitized.commissionFormula = sanitizeString(body.commissionFormula);
        
        if (body.leaveDayRate !== undefined) sanitized.leaveDayRate = sanitizeNumber(body.leaveDayRate);
        if (body.payLeaveDays !== undefined) sanitized.payLeaveDays = sanitizeBoolean(body.payLeaveDays);
        if (body.holidayDayRate !== undefined) sanitized.holidayDayRate = sanitizeNumber(body.holidayDayRate);
        if (body.payHolidayDays !== undefined) sanitized.payHolidayDays = sanitizeBoolean(body.payHolidayDays);
        if (body.offDayRate !== undefined) sanitized.offDayRate = sanitizeNumber(body.offDayRate);
        if (body.payOffDays !== undefined) sanitized.payOffDays = sanitizeBoolean(body.payOffDays);
        
        if (body.leadSplit2 !== undefined) sanitized.leadSplit2 = Math.round(sanitizeNumber(body.leadSplit2));
        if (body.asstSplit2 !== undefined) sanitized.asstSplit2 = Math.round(sanitizeNumber(body.asstSplit2));
        if (body.leadSplit3 !== undefined) sanitized.leadSplit3 = Math.round(sanitizeNumber(body.leadSplit3));
        if (body.asst1Split3 !== undefined) sanitized.asst1Split3 = Math.round(sanitizeNumber(body.asst1Split3));
        if (body.asst2Split3 !== undefined) sanitized.asst2Split3 = Math.round(sanitizeNumber(body.asst2Split3));
        
        if (body.fixedBaseAmount !== undefined) sanitized.fixedBaseAmount = sanitizeNumber(body.fixedBaseAmount);
        
        if (body.activeDayTransport !== undefined) sanitized.activeDayTransport = sanitizeNumber(body.activeDayTransport);
        if (body.passiveDayTransport !== undefined) sanitized.passiveDayTransport = sanitizeNumber(body.passiveDayTransport);
        if (body.commissionRate !== undefined) sanitized.commissionRate = sanitizeNumber(body.commissionRate);
        if (body.defaultPayrollPeriod !== undefined) sanitized.defaultPayrollPeriod = sanitizeString(body.defaultPayrollPeriod);
        if (body.maxAssistingStaff !== undefined) sanitized.maxAssistingStaff = Math.round(sanitizeNumber(body.maxAssistingStaff));
        if (body.receiptPrefix !== undefined) sanitized.receiptPrefix = sanitizeString(body.receiptPrefix);
        if (body.receiptThankYouMessage !== undefined) sanitized.receiptThankYouMessage = sanitizeString(body.receiptThankYouMessage);
        if (body.lowStockThreshold !== undefined) sanitized.lowStockThreshold = Math.round(sanitizeNumber(body.lowStockThreshold));
        if (body.borrowBookReminderDaysBefore !== undefined) sanitized.borrowBookReminderDaysBefore = Math.round(sanitizeNumber(body.borrowBookReminderDaysBefore));
        if (body.borrowBookReminderOnDueDate !== undefined) sanitized.borrowBookReminderOnDueDate = sanitizeBoolean(body.borrowBookReminderOnDueDate);
        if (body.borrowBookReminderDaysAfter !== undefined) sanitized.borrowBookReminderDaysAfter = Math.round(sanitizeNumber(body.borrowBookReminderDaysAfter));
        if (body.borrowBookReminderRepeatDays !== undefined) sanitized.borrowBookReminderRepeatDays = Math.round(sanitizeNumber(body.borrowBookReminderRepeatDays));
        if (body.borrowBookReminderStopDays !== undefined) sanitized.borrowBookReminderStopDays = Math.round(sanitizeNumber(body.borrowBookReminderStopDays));
        if (body.borrowBookReminderLanguage !== undefined) sanitized.borrowBookReminderLanguage = sanitizeString(body.borrowBookReminderLanguage);
        if (body.whatsappGatewayConfigured !== undefined) sanitized.whatsappGatewayConfigured = sanitizeBoolean(body.whatsappGatewayConfigured);
        if (body.smsGatewayConfigured !== undefined) sanitized.smsGatewayConfigured = sanitizeBoolean(body.smsGatewayConfigured);

        if (body.loyaltyPointsPerCurrency !== undefined) sanitized.loyaltyPointsPerCurrency = Math.max(1, Math.round(sanitizeNumber(body.loyaltyPointsPerCurrency)));
        if (body.loyaltyPointValue !== undefined) sanitized.loyaltyPointValue = Math.max(0, sanitizeNumber(body.loyaltyPointValue));

        // ── Attendance & Clock-In ──────────────────────────────────────────
        // This allowlist is the only thing standing between the client and these
        // columns, so the clamps here are the real validation, not decoration.
        if (body.clockInEnabled !== undefined) sanitized.clockInEnabled = sanitizeBoolean(body.clockInEnabled);
        if (body.lateDeductionEnabled !== undefined) sanitized.lateDeductionEnabled = sanitizeBoolean(body.lateDeductionEnabled);
        if (body.requirePunchPin !== undefined) sanitized.requirePunchPin = sanitizeBoolean(body.requirePunchPin);
        if (body.openingTime !== undefined) sanitized.openingTime = sanitizeString(body.openingTime);
        if (body.geofencePlaceLabel !== undefined) sanitized.geofencePlaceLabel = sanitizeString(body.geofencePlaceLabel);
        // Null clears the fence; a number is range-checked in validateAttendanceSettings.
        if (body.geofenceLatitude !== undefined) {
          sanitized.geofenceLatitude = body.geofenceLatitude === null ? null : sanitizeNumber(body.geofenceLatitude);
        }
        if (body.geofenceLongitude !== undefined) {
          sanitized.geofenceLongitude = body.geofenceLongitude === null ? null : sanitizeNumber(body.geofenceLongitude);
        }
        if (body.geofenceRadiusMeters !== undefined) {
          sanitized.geofenceRadiusMeters = clampInt(body.geofenceRadiusMeters, 10, 5000);
        }
        if (body.geofenceMaxAccuracyMeters !== undefined) {
          sanitized.geofenceMaxAccuracyMeters = clampInt(body.geofenceMaxAccuracyMeters, 10, 1000);
        }
        if (body.lateGraceMinutes !== undefined) sanitized.lateGraceMinutes = clampInt(body.lateGraceMinutes, 0, 720);
        if (body.lateDeductionAmount !== undefined) {
          // Deliberately uncapped against the day's transport — the business owner
          // chose for a late arrival to be able to cost more than the day is worth.
          sanitized.lateDeductionAmount = Math.max(0, sanitizeNumber(body.lateDeductionAmount));
        }
        if (body.maxOfflinePunchAgeMinutes !== undefined) {
          sanitized.maxOfflinePunchAgeMinutes = clampInt(body.maxOfflinePunchAgeMinutes, 0, 10080);
        }
        if (body.retroRequestMaxAgeDays !== undefined) {
          sanitized.retroRequestMaxAgeDays = clampInt(body.retroRequestMaxAgeDays, 0, 90);
        }
        if (body.defaultWeeklyOffDays !== undefined) {
          sanitized.defaultWeeklyOffDays = normaliseWeekdays(body.defaultWeeklyOffDays);
        }

        return sanitized;
      };

      // Rejected rather than coerced: a malformed opening time would silently make
      // every staff member permanently late (or never late), and half a coordinate
      // pair would produce a fence centred on the equator.
      const attendanceError = validateAttendanceSettings(data);
      if (attendanceError) return res.status(400).json({ error: attendanceError });

      const sanitizedData = sanitizeSettings(data);

      if (storeId === "all") {
        const businessId = (req as any).user?.businessId || (req as any).user?.organisationId;
        if (!businessId) return res.status(400).json({ error: "Business ID required." });
        if (!(await checkBusinessAccess(businessId, req, res))) return;

        // 1. Update business-level receipt prefix
        if (sanitizedData.receiptPrefix) {
          await storage.updateBusiness(businessId, { receiptPrefix: sanitizedData.receiptPrefix });
        }

        // 2. Update all stores under this business with the thank you message and low stock threshold
        const storesList = await storage.getStores(businessId);
        for (const s of storesList) {
          await storage.upsertSettings(s.id, {
            receiptThankYouMessage: sanitizedData.receiptThankYouMessage,
            lowStockThreshold: sanitizedData.lowStockThreshold,
          });
          
          // Auto-recalculate payroll for each store to match new thresholds/settings
          const todayStr = new Date().toISOString().split("T")[0];
          triggerAutoRecalculate(s.id, todayStr).catch(console.error);
        }

        const userId = (req as any).user?.id;
        auditLogger.log({ action: "SETTINGS_UPDATE", resource: "settings", resourceId: "all", userId, ip: getClientIp(req), status: "success", details: { storeId: "all" } });
        return res.json({
          id: "all",
          storeId: "all",
          receiptPrefix: sanitizedData.receiptPrefix,
          receiptThankYouMessage: sanitizedData.receiptThankYouMessage,
          lowStockThreshold: sanitizedData.lowStockThreshold,
        });
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;

      const updated = await storage.upsertSettings(storeId, sanitizedData);

      // Auto-recalculate any active period to immediately reflect updated default rates
      const todayStr = new Date().toISOString().split("T")[0];
      triggerAutoRecalculate(storeId, todayStr).catch(console.error);

      auditLogger.log({ action: "SETTINGS_UPDATE", resource: "settings", resourceId: storeId, userId: (req as any).user?.id, ip: getClientIp(req), status: "success", details: { storeId } });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Could not update settings." });
    }
  });
  // ========== PROMOTIONS ==========
  app.get("/api/promotions", isAuthenticated, async (req, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) return res.status(400).json({ error: "Store ID required." });

      if (storeId === "all") {
        const stores = await getUserStores(req);
        if (stores.length === 0) return res.json([]);
        const list = await Promise.all(
          stores.map(async (s) => {
            const promos = await storage.getPromotions(s.id);
            return promos.map(p => ({ ...p, storeName: s.name }));
          })
        );
        return res.json(list.flat().sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
      }

      if (!(await checkStoreAccess(storeId, req, res))) return;
      const result = await storage.getPromotions(storeId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Could not load promotions." });
    }
  });

  app.post("/api/promotions", requireManagerOrOwner, async (req, res) => {
    try {
      const data = insertPromotionSchema.parse(req.body);
      if (!(await checkStoreAccess(data.storeId, req, res))) return;

      // Only owner/manager can edit promotions
      const role = (req as any).user?.role;
      if (role !== "manager" && role !== "owner") {
        return res.status(403).json({ error: "Only managers and owners can manage promotions." });
      }

      const promotion = await storage.createPromotion(data);
      auditLogger.logDataModification("promotions", promotion.id, getUserId(req), "CREATE", true);
      res.status(201).json(promotion);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not create promotion." });
    }
  });

  app.patch("/api/promotions/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const { id } = req.params;
      const data = insertPromotionSchema.partial().parse(req.body);
      
      const promotion = await db.select().from(promotions).where(eq(promotions.id, id)).then(r => r[0]);
      if (!promotion) return res.status(404).json({ error: "Promotion not found." });
      if (!(await checkStoreAccess(promotion.storeId, req, res))) return;

      // Only owner/manager can edit promotions
      const role = (req as any).user?.role;
      if (role !== "manager" && role !== "owner") {
        return res.status(403).json({ error: "Only managers and owners can manage promotions." });
      }

      const updated = await storage.updatePromotion(id, data);
      auditLogger.logDataModification("promotions", id, getUserId(req), "UPDATE", true);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not update promotion." });
    }
  });

  app.delete("/api/promotions/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const { id } = req.params;
      const promotion = await db.select().from(promotions).where(eq(promotions.id, id)).then(r => r[0]);
      if (!promotion) return res.status(404).json({ error: "Promotion not found." });
      if (!(await checkStoreAccess(promotion.storeId, req, res))) return;

      // Only owner/manager can edit promotions
      const role = (req as any).user?.role;
      if (role !== "manager" && role !== "owner") {
        return res.status(403).json({ error: "Only managers and owners can manage promotions." });
      }

      await storage.deletePromotion(id);
      auditLogger.logDataModification("promotions", id, getUserId(req), "DELETE", true);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete promotion." });
    }
  });
  // ========== CUSTOM ROLES ==========
  app.get("/api/custom-roles", isAuthenticated, async (req, res) => {
    try {
      const businessId = (req as any).user?.businessId;
      if (!businessId) return res.status(401).json({ error: "Unauthorized access." });
      
      const roles = await storage.getCustomRoles(businessId);
      res.json(roles);
    } catch (error) {
      res.status(500).json({ error: "Could not load custom roles." });
    }
  });

  app.post("/api/custom-roles", isAuthenticated, async (req, res) => {
    try {
      const businessId = (req as any).user?.businessId;
      if (!businessId) return res.status(401).json({ error: "Unauthorized access." });

      const role = (req as any).user?.role;
      if (role !== "owner") {
        return res.status(403).json({ error: "Only owners can manage custom roles." });
      }

      const data = insertCustomRoleSchema.parse({
        ...req.body,
        businessId,
      });
      const customRole = await storage.createCustomRole(data);

      auditLogger.logDataModification("custom_roles", customRole.id, getUserId(req), "CREATE", true);
      res.status(201).json(customRole);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not create custom role." });
    }
  });

  app.patch("/api/custom-roles/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const businessId = (req as any).user?.businessId;
      if (!businessId) return res.status(401).json({ error: "Unauthorized access." });

      const role = (req as any).user?.role;
      if (role !== "owner") {
        return res.status(403).json({ error: "Only owners can manage custom roles." });
      }

      const existing = await db.select().from(customRoles).where(eq(customRoles.id, id)).then(r => r[0]);
      if (!existing || existing.businessId !== businessId) {
        return res.status(404).json({ error: "Role not found." });
      }

      const data = insertCustomRoleSchema.partial().parse(req.body);
      const updated = await storage.updateCustomRole(id, data);
      
      auditLogger.logDataModification("custom_roles", id, getUserId(req), "UPDATE", true);
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "Could not update custom role." });
    }
  });

  app.delete("/api/custom-roles/:id", isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      const businessId = (req as any).user?.businessId;
      if (!businessId) return res.status(401).json({ error: "Unauthorized access." });

      const role = (req as any).user?.role;
      if (role !== "owner") {
        return res.status(403).json({ error: "Only owners can manage custom roles." });
      }

      const existing = await db.select().from(customRoles).where(eq(customRoles.id, id)).then(r => r[0]);
      if (!existing || existing.businessId !== businessId) {
        return res.status(404).json({ error: "Role not found." });
      }

      await storage.deleteCustomRole(id);
      auditLogger.logDataModification("custom_roles", id, getUserId(req), "DELETE", true);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Could not delete custom role." });
    }
  });

}
