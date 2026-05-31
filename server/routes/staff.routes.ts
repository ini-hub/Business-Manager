import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  sendActivationEmail,
  sendAddedToOrgEmail,
} from "../email";

const SALT_ROUNDS = 12;
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

export function registerStaffRoutes(app: Express, { isAuthenticated: _isAuth, requireRole, requireManagerOrOwner, checkStoreAccess }: RouteMiddlewares): void {
  // ========== STAFF ==========
  app.get("/api/staff", async (req: any, res) => {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return res.status(400).json({ error: "Please select a store first." });
      }
      if (!(await checkStoreAccess(storeId, req, res))) return;

      const redactWages = (list: any[]) => {
        list.forEach(s => {
          s.payPerMonth = 0;
          s.commissionRateOverride = null;
          s.commissionFixedAmountOverride = null;
          s.activeDayRateOverride = null;
          s.passiveDayRateOverride = null;
          s.leaveDayRateOverride = null;
          s.holidayDayRateOverride = null;
          s.offDayRateOverride = null;
        });
      };

      // Support both paginated and non-paginated queries
      const page = parseInt(req.query.page as string) || 0;
      const limit = parseInt(req.query.limit as string) || 0;

      if (page > 0 && limit > 0) {
        const search = req.query.search as string;
        const includeArchived = req.query.includeArchived === 'true';
        const result = await storage.getStaffPaginated(storeId, { page, limit, search, includeArchived });
        if (req.user?.role === "staff") {
          redactWages(result.data);
        }
        return res.json(result);
      }

      const staffList = await storage.getStaffList(storeId);
      if (req.user?.role === "staff") {
        redactWages(staffList);
      }
      res.json(staffList);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load your staff members. Please try again." });
    }
  });

  app.get("/api/staff/:id", async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      if ((req as any).user?.role === "staff") {
        staffMember.payPerMonth = 0;
        staffMember.commissionRateOverride = null;
        staffMember.commissionFixedAmountOverride = null;
        staffMember.activeDayRateOverride = null;
        staffMember.passiveDayRateOverride = null;
        staffMember.leaveDayRateOverride = null;
        staffMember.holidayDayRateOverride = null;
        staffMember.offDayRateOverride = null;
      }

      res.json(staffMember);
    } catch (error) {
      res.status(500).json({ error: "We couldn't load staff information. Please try again." });
    }
  });

  app.post("/api/staff", requireManagerOrOwner, async (req, res) => {
    try {
      const sanitizeOptionalNumber = (val: any) => {
        if (val === undefined || val === null || val === "") return null;
        return sanitizeNumber(val);
      };

      const sanitizedBody = {
        ...req.body,
        name: sanitizeString(req.body.name),
        email: sanitizeString(req.body.email)?.toLowerCase(),
        mobileNumber: sanitizePhoneNumber(req.body.mobileNumber),
        payPerMonth: sanitizeNumber(req.body.payPerMonth),
        signedContract: sanitizeBoolean(req.body.signedContract),
        role: req.body.role || "staff",
        // Staff compensation and payment overrides
        overridePaymentMethod: sanitizeBoolean(req.body.overridePaymentMethod),
        overrideCommission: sanitizeBoolean(req.body.overrideCommission),
        overrideFormula: sanitizeBoolean(req.body.overrideFormula),
        overrideAttendanceRates: sanitizeBoolean(req.body.overrideAttendanceRates),
        
        commissionFixedAmountOverride: sanitizeOptionalNumber(req.body.commissionFixedAmountOverride),
        commissionTypeOverride: req.body.commissionTypeOverride ? sanitizeString(req.body.commissionTypeOverride) : null,
        commissionFormulaOverride: req.body.commissionFormulaOverride ? sanitizeString(req.body.commissionFormulaOverride) : null,
        
        activeDayRateOverride: sanitizeOptionalNumber(req.body.activeDayRateOverride),
        passiveDayRateOverride: sanitizeOptionalNumber(req.body.passiveDayRateOverride),
        leaveDayRateOverride: sanitizeOptionalNumber(req.body.leaveDayRateOverride),
        holidayDayRateOverride: sanitizeOptionalNumber(req.body.holidayDayRateOverride),
        offDayRateOverride: sanitizeOptionalNumber(req.body.offDayRateOverride),
        
        payLeaveDaysOverride: sanitizeBoolean(req.body.payLeaveDaysOverride),
        payHolidayDaysOverride: sanitizeBoolean(req.body.payHolidayDaysOverride),
        payOffDaysOverride: sanitizeBoolean(req.body.payOffDaysOverride),
      };
      const data = insertStaffSchema.parse(sanitizedBody);
      if (data.storeId && !(await checkStoreAccess(data.storeId, req, res))) return;
      const staffMember = await storage.createStaff(data);
      auditLogger.logDataModification("staff", staffMember.id, getUserId(req), "CREATE", true);

      // Staff invitation and activation email flow
      try {
        const store = data.storeId ? await storage.getStore(data.storeId) : null;
        const resolvedBusinessId = store?.businessId || (req as any).user?.organisationId || (req as any).user?.businessId;
        const business = resolvedBusinessId ? await storage.getBusinessById(resolvedBusinessId) : null;
        const businessName = business ? business.name : "Business Workspace";

        if (resolvedBusinessId && data.email) {
          const emailLower = data.email.toLowerCase();
          let user = await storage.getUserByIdentifier(emailLower);

          if (user) {
            // Existing platform user: add them to the business organisation if not already member
            const member = await storage.getOrganisationMember(user.id, resolvedBusinessId);
            if (!member) {
              await storage.createOrganisationMember({
                userId: user.id,
                organisationId: resolvedBusinessId,
                role: data.role || "staff",
                staffId: staffMember.staffNumber,
                status: "active",
                activatedAt: new Date(),
              });
            }

            // Link the staff record to the existing user
            await storage.updateStaff(staffMember.id, { userId: user.id });

            // Send notification email that they were added
            const inviterName = (req as any).user?.name || "The Business Owner";
            await sendAddedToOrgEmail(
              emailLower,
              staffMember.name,
              businessName,
              data.role || "staff",
              inviterName
            );
          } else {
            // New user account: generate a premium XXXX-XXXX activation code
            const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            let activationCode = "";
            for (let i = 0; i < 4; i++) {
              activationCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            activationCode += "-";
            for (let i = 0; i < 4; i++) {
              activationCode += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            const placeholderPassword = await bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);

            // Create new platform user as pre-verified
            const newUser = await storage.createUser({
              email: emailLower,
              password: placeholderPassword,
              businessId: resolvedBusinessId,
              role: data.role as "manager" | "staff",
              isVerified: true,
              activationCode,
              activationCodeExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
              activationCodeUsed: false,
              createdByInvitation: true,
            });

            await storage.updateUser(newUser.id, {
              passwordHash: placeholderPassword,
            });

            // Create pending organization membership record
            await storage.createOrganisationMember({
              userId: newUser.id,
              organisationId: resolvedBusinessId,
              role: data.role || "staff",
              staffId: staffMember.staffNumber,
              status: "pending",
            });

            // Link the staff record to the new user
            await storage.updateStaff(staffMember.id, { userId: newUser.id });

            // Send the activation email
            await sendActivationEmail(
              emailLower,
              staffMember.name,
              businessName,
              data.role || "staff",
              activationCode
            );
          }
        }
      } catch (inviteError) {
        console.error("Failed to process invite/activation email for staff member:", inviteError);
      }

      res.status(201).json(staffMember);
    } catch (error) {
      auditLogger.logDataModification("staff", undefined, getUserId(req), "CREATE", false, (error as Error).message);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      // Check for duplicate email constraint error
      const errorMessage = (error as Error).message || "";
      if (errorMessage.includes("unique") || errorMessage.includes("duplicate") || errorMessage.includes("email")) {
        return res.status(409).json({
          error: "This email address is already assigned to another staff member. Please use a different email."
        });
      }
      res.status(500).json({ error: "We couldn't add this staff member right now. Please try again." });
    }
  });

  app.patch("/api/staff/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const sanitizeOptionalNumber = (val: any) => {
        if (val === undefined || val === null || val === "") return null;
        return sanitizeNumber(val);
      };

      const sanitizedBody: any = {
        ...req.body,
        ...(req.body.name !== undefined && { name: sanitizeString(req.body.name) }),
        ...(req.body.email !== undefined && { email: sanitizeString(req.body.email)?.toLowerCase() }),
        ...(req.body.mobileNumber !== undefined && { mobileNumber: sanitizePhoneNumber(req.body.mobileNumber) }),
        ...(req.body.payPerMonth !== undefined && { payPerMonth: sanitizeNumber(req.body.payPerMonth) }),
        ...(req.body.signedContract !== undefined && { signedContract: sanitizeBoolean(req.body.signedContract) }),
        
        ...(req.body.overridePaymentMethod !== undefined && { overridePaymentMethod: sanitizeBoolean(req.body.overridePaymentMethod) }),
        ...(req.body.overrideCommission !== undefined && { overrideCommission: sanitizeBoolean(req.body.overrideCommission) }),
        ...(req.body.overrideFormula !== undefined && { overrideFormula: sanitizeBoolean(req.body.overrideFormula) }),
        ...(req.body.overrideAttendanceRates !== undefined && { overrideAttendanceRates: sanitizeBoolean(req.body.overrideAttendanceRates) }),
        
        ...(req.body.commissionFixedAmountOverride !== undefined && { commissionFixedAmountOverride: sanitizeOptionalNumber(req.body.commissionFixedAmountOverride) }),
        ...(req.body.commissionTypeOverride !== undefined && { commissionTypeOverride: req.body.commissionTypeOverride ? sanitizeString(req.body.commissionTypeOverride) : null }),
        ...(req.body.commissionFormulaOverride !== undefined && { commissionFormulaOverride: req.body.commissionFormulaOverride ? sanitizeString(req.body.commissionFormulaOverride) : null }),
        
        ...(req.body.activeDayRateOverride !== undefined && { activeDayRateOverride: sanitizeOptionalNumber(req.body.activeDayRateOverride) }),
        ...(req.body.passiveDayRateOverride !== undefined && { passiveDayRateOverride: sanitizeOptionalNumber(req.body.passiveDayRateOverride) }),
        ...(req.body.leaveDayRateOverride !== undefined && { leaveDayRateOverride: sanitizeOptionalNumber(req.body.leaveDayRateOverride) }),
        ...(req.body.holidayDayRateOverride !== undefined && { holidayDayRateOverride: sanitizeOptionalNumber(req.body.holidayDayRateOverride) }),
        ...(req.body.offDayRateOverride !== undefined && { offDayRateOverride: sanitizeOptionalNumber(req.body.offDayRateOverride) }),
        
        ...(req.body.payLeaveDaysOverride !== undefined && { payLeaveDaysOverride: sanitizeBoolean(req.body.payLeaveDaysOverride) }),
        ...(req.body.payHolidayDaysOverride !== undefined && { payHolidayDaysOverride: sanitizeBoolean(req.body.payHolidayDaysOverride) }),
        ...(req.body.payOffDaysOverride !== undefined && { payOffDaysOverride: sanitizeBoolean(req.body.payOffDaysOverride) }),
      };
      // Remove storeId to prevent cross-store migration via PATCH (use transfer endpoint instead)
      delete sanitizedBody.storeId;
      const data = insertStaffSchema.partial().parse(sanitizedBody);
      const updatedStaffMember = await storage.updateStaff(req.params.id, data);
      if (!updatedStaffMember) {
        return res.status(404).json({ error: "This staff member no longer exists. They may have been removed." });
      }
      res.json(updatedStaffMember);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: formatZodErrors(error.errors) });
      }
      res.status(500).json({ error: "We couldn't update this staff member right now. Please try again." });
    }
  });

  app.delete("/api/staff/:id", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      // Archive instead of delete (soft delete)
      const archived = await storage.archiveStaff(req.params.id);
      if (!archived) {
        return res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "We couldn't archive this staff member. Please try again." });
    }
  });

  // Restore archived staff
  app.post("/api/staff/:id/restore", requireManagerOrOwner, async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      const restored = await storage.restoreStaff(req.params.id);
      if (!restored) {
        return res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
      }
      res.json(restored);
    } catch (error) {
      res.status(500).json({ error: "We couldn't restore this staff member. Please try again." });
    }
  });

  // Transfer staff to another store
  app.post("/api/staff/:id/transfer", requireManagerOrOwner, async (req, res) => {
    try {
      const { targetStoreId } = req.body;
      if (!targetStoreId) {
        return res.status(400).json({ error: "Please select a store to transfer to." });
      }

      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      // Verify user has access to the target store
      if (!await verifyStoreAccess(req, targetStoreId)) {
        return res.status(403).json({ error: "You don't have access to the target store." });
      }

      // Get the source store's business
      const sourceStore = await storage.getStore(staffMember.storeId);
      if (!sourceStore) {
        return res.status(404).json({ error: "Source store not found." });
      }

      // Get the target store and verify it belongs to the same business
      const targetStore = await storage.getStore(targetStoreId);
      if (!targetStore) {
        return res.status(404).json({ error: "Target store not found." });
      }

      if (sourceStore.businessId !== targetStore.businessId) {
        return res.status(403).json({ error: "Staff can only be transferred to stores within the same business." });
      }

      if (staffMember.storeId === targetStoreId) {
        return res.status(400).json({ error: "Staff member is already in this store." });
      }

      // Check if a staff member with this email already exists in the target store
      const existingInTarget = await db.select()
        .from(staff)
        .where(and(eq(staff.storeId, targetStoreId), eq(staff.email, staffMember.email)))
        .limit(1);

      if (existingInTarget.length > 0) {
        return res.status(400).json({
          error: "This staff member's email is already registered in the target store (e.g. they are already configured there). They cannot be transferred."
        });
      }

      // Use the storage method to transfer staff with auto-generated staff number
      const updated = await storage.transferStaff(req.params.id, targetStoreId);

      if (!updated) {
        return res.status(500).json({ error: "We couldn't transfer this staff member. Please try again." });
      }

      res.json(updated);
    } catch (error) {
      console.error("Staff transfer error:", error);
      res.status(500).json({ error: "We couldn't transfer this staff member. Please try again." });
    }
  });

  // Permanently delete archived staff
  app.delete("/api/staff/:id/permanent", requireRole("owner"), async (req, res) => {
    try {
      const staffMember = await storage.getStaff(req.params.id);
      if (!staffMember) {
        return res.status(404).json({ error: "Staff member not found." });
      }

      // Verify user has access to this staff member's store
      if (!await verifyRecordStoreAccess(req, staffMember.storeId)) {
        return res.status(403).json({ error: "You don't have access to this staff member." });
      }

      if (!staffMember.isArchived) {
        return res.status(400).json({ error: "Only archived staff can be permanently deleted." });
      }

      const hasCheckouts = await storage.hasStaffCheckouts(req.params.id);
      if (hasCheckouts) {
        return res.status(400).json({
          error: "Cannot permanently delete staff member with existing sales records. This staff member has processed sales that must be preserved for your records."
        });
      }

      const deleted = await storage.deleteStaff(req.params.id);
      if (!deleted) {
        return res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Permanent delete staff error:", error);
      res.status(500).json({ error: "We couldn't delete this staff member. Please try again." });
    }
  });

  // Bulk import staff
  app.post("/api/staff/bulk", requireManagerOrOwner, async (req, res) => {
    try {
      const { data, storeId } = req.body;
      if (!Array.isArray(data) || !storeId) {
        return res.status(400).json({ error: "Invalid data format or missing store." });
      }

      // Verify user has access to this store
      if (!await verifyStoreAccess(req, storeId)) {
        return res.status(403).json({ error: "You don't have access to this store." });
      }

      const result = await bulkUploadService.importStaff(data, storeId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "We couldn't import your staff. Please try again." });
    }
  });

}
