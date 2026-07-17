import { Router, Request, Response } from "express";
import { z } from "zod";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import { bulkUploadService } from "../services/BulkUploadService";

const bookingItemSchema = z.object({
  inventoryId: z.string().uuid("Valid inventory ID is required"),
  quantity: z.number().min(1, "Quantity must be at least 1"),
  unitPrice: z.number().min(0, "Unit price cannot be negative"),
  totalPrice: z.number().min(0, "Total price cannot be negative"),
});

const createBookingSchema = z.object({
  storeId: z.string().uuid("Store ID is required"),
  customerId: z.string().uuid("Customer ID is required"),
  type: z.enum(["appointment", "order"]),
  status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show", "rescheduled"]).optional(),
  scheduledAt: z.string().transform((value) => new Date(value)),
  expectedReadyAt: z.string().optional().transform((value) => (value ? new Date(value) : undefined)),
  leadStaffId: z.string().uuid().optional(),
  assistingStaffId: z.string().uuid().optional(),
  depositAmount: z.number().min(0).optional().default(0),
  depositPaymentMethod: z.enum(["cash", "transfer", "pos"]).optional(),
  subtotal: z.number().min(0).optional().default(0),
  discountAmount: z.number().min(0).optional().default(0),
  discountPercent: z.number().min(0).optional().default(0),
  discountReason: z.string().optional(),
  discountApprovedBy: z.string().optional(),
  totalPrice: z.number().min(0).optional().default(0),
  reminderPreference: z.enum(["whatsapp", "sms", "both", "none"]).default("whatsapp"),
  notes: z.string().optional(),
  bookingItems: z.array(bookingItemSchema).min(1, "At least one booking item is required"),
});

const statusSchema = z.object({
  status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled", "no_show", "rescheduled"]),
});

const rescheduleSchema = z.object({
  scheduledAt: z.string().transform((value) => new Date(value)),
  reason: z.string().min(1, "Reschedule reason is required"),
});

function userHasManagerAccess(req: Request): boolean {
  const user = (req as any).user;
  return user?.role === "owner" || user?.role === "manager";
}

function parseCsvQueryParam(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export class BookingController extends BaseController {
  public register(router: Router): void {
    router.get("/bookings", isAuthenticated, this.getBookings.bind(this));
    router.get("/bookings/summary", isAuthenticated, this.getBookingsSummary.bind(this));
    router.get("/bookings/:id", isAuthenticated, this.getBooking.bind(this));
    router.post("/bookings", isAuthenticated, this.createBooking.bind(this));
    router.post("/bookings/bulk", isAuthenticated, this.bulkImportBookings.bind(this));
    router.patch("/bookings/:id", isAuthenticated, this.updateBooking.bind(this));
    router.patch("/bookings/:id/status", isAuthenticated, this.updateBookingStatus.bind(this));
    router.patch("/bookings/:id/reschedule", isAuthenticated, this.rescheduleBooking.bind(this));
  }

  private async getBookings(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please provide a store ID.");
      }
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const filters = {
        status: parseCsvQueryParam(req.query.status as string),
        type: parseCsvQueryParam(req.query.type as string),
        customerId: req.query.customerId as string | undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        search: req.query.search as string | undefined,
      };

      const user = (req as any).user;
      if (user?.role === "staff") {
        const staffId = user.staffId as string | undefined;
        if (!staffId) {
          return this.forbidden(res, "Staff access requires a linked staff record.");
        }
        Object.assign(filters, { staffId });
      }

      const result = await storage.getBookingsPaginated(storeId, { page, limit }, filters);
      const enrichedData = await Promise.all(result.data.map(async (b) => {
        const customer = await storage.getCustomer(b.customerId);
        return { ...b, customer };
      }));
      return this.ok(res, {
        ...result,
        data: enrichedData
      });
    } catch (error) {
      return this.error(res, "Unable to fetch bookings. Please try again.");
    }
  }

  private async getBookingsSummary(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please provide a store ID.");
      }
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const groupBy = req.query.groupBy === "month" ? "month" : "day";
      const filters = {
        status: parseCsvQueryParam(req.query.status as string),
        type: parseCsvQueryParam(req.query.type as string),
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      };

      const user = (req as any).user;
      if (user?.role === "staff") {
        const staffId = user.staffId as string | undefined;
        if (!staffId) {
          return this.forbidden(res, "Staff access requires a linked staff record.");
        }
        Object.assign(filters, { staffId });
      }

      const summary = await storage.getBookingsSummary(storeId, groupBy, filters);
      return this.ok(res, summary);
    } catch (error) {
      return this.error(res, "Unable to fetch booking summary. Please try again.");
    }
  }

  private async getBooking(req: Request, res: Response): Promise<Response> {
    try {
      const bookingId = req.params.id;
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return this.notFound(res, "Booking not found.");
      }

      if (!(await this.checkStoreAccess(booking.storeId, req, res))) return res;
      const user = (req as any).user;
      if (user?.role === "staff") {
        const staffId = user.staffId as string | undefined;
        if (!staffId || (booking.leadStaffId !== staffId && booking.assistingStaffId !== staffId)) {
          return this.forbidden(res, "You are not authorized to view this booking.");
        }
      }

      const items = await storage.getBookingItems(bookingId);
      
      const customer = await storage.getCustomer(booking.customerId);
      const leadStaff = booking.leadStaffId ? await storage.getStaff(booking.leadStaffId) : null;
      
      const enrichedItems = await Promise.all(items.map(async (item) => {
        const inventory = await storage.getInventoryItem(item.inventoryId);
        return { ...item, inventory };
      }));

      return this.ok(res, { 
        ...booking, 
        customer,
        leadStaff,
        items: enrichedItems 
      });
    } catch (error) {
      return this.error(res, "Unable to load booking details. Please try again.");
    }
  }

  private async createBooking(req: Request, res: Response): Promise<Response> {
    try {
      if (!userHasManagerAccess(req)) {
        return this.forbidden(res, "Only managers and owners can create bookings.");
      }

      const parsed = createBookingSchema.parse(req.body);
      if (!(await this.checkStoreAccess(parsed.storeId, req, res))) return res;

      const newBooking = await storage.createBooking(parsed as any);
      const items = await storage.getBookingItems(newBooking.id);
      return this.created(res, { ...newBooking, items });
    } catch (error) {
      console.error("CREATE BOOKING ERROR:", error);
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map((err) => err.message).join(". "));
      }
      return this.error(res, "Unable to create booking. Please try again. " + String(error) + (error instanceof Error ? " - " + error.message : ""));
    }
  }

  private async bulkImportBookings(req: Request, res: Response): Promise<Response> {
    try {
      if (!userHasManagerAccess(req)) {
        return this.forbidden(res, "Only managers and owners can import bookings.");
      }
      const { data, storeId } = req.body;
      if (!storeId || !Array.isArray(data)) {
        return this.badRequest(res, "storeId and a data array are required.");
      }
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const userId = (req as any).user?.id;
      const result = await bulkUploadService.importBookings(data, storeId, userId);
      return this.ok(res, result);
    } catch (error) {
      console.error("Bulk import bookings controller error:", error);
      return this.error(res, "Could not import bookings. Please try again.");
    }
  }

  private async updateBooking(req: Request, res: Response): Promise<Response> {
    try {
      if (!userHasManagerAccess(req)) {
        return this.forbidden(res, "Only managers and owners can edit bookings.");
      }
      const bookingId = req.params.id;
      const existing = await storage.getBooking(bookingId);
      if (!existing) return this.notFound(res, "Booking not found.");
      if (existing.status === "completed") {
        return this.badRequest(res, "Completed bookings cannot be edited.");
      }
      if (!(await this.checkStoreAccess(existing.storeId, req, res))) return res;

      const updateSchema = createBookingSchema.omit({ storeId: true }).partial().extend({
        bookingItems: z.array(bookingItemSchema).min(1).optional(),
      });
      const parsed = updateSchema.parse(req.body);
      const updated = await storage.updateBooking(bookingId, parsed as any);
      if (!updated) return this.error(res, "Could not update booking.");
      const items = await storage.getBookingItems(bookingId);
      return this.ok(res, { ...updated, items });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map((e) => e.message).join(". "));
      }
      return this.error(res, "Unable to update booking. Please try again.");
    }
  }

  private async updateBookingStatus(req: Request, res: Response): Promise<Response> {
    try {
      if (!userHasManagerAccess(req)) {
        return this.forbidden(res, "Only managers and owners can update booking status.");
      }

      const bookingId = req.params.id;
      const { status } = statusSchema.parse(req.body);
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return this.notFound(res, "Booking not found.");
      }
      if (booking.status === "completed") {
        return this.badRequest(res, "Completed bookings cannot be modified.");
      }
      if (!(await this.checkStoreAccess(booking.storeId, req, res))) return res;

      const updated = await storage.updateBookingStatus(bookingId, status);
      return updated ? this.ok(res, updated) : this.error(res, "Could not update booking status.");
    } catch (error) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map((err) => err.message).join(". "));
      }
      return this.error(res, "Unable to update booking status. Please try again.");
    }
  }

  private async rescheduleBooking(req: Request, res: Response): Promise<Response> {
    try {
      if (!userHasManagerAccess(req)) {
        return this.forbidden(res, "Only managers and owners can reschedule bookings.");
      }

      const bookingId = req.params.id;
      const parsed = rescheduleSchema.parse(req.body);
      const booking = await storage.getBooking(bookingId);
      if (!booking) {
        return this.notFound(res, "Booking not found.");
      }
      if (booking.status === "completed") {
        return this.badRequest(res, "Completed bookings cannot be modified.");
      }
      if (!(await this.checkStoreAccess(booking.storeId, req, res))) return res;

      const updated = await storage.rescheduleBooking(bookingId, parsed.scheduledAt, parsed.reason);
      return updated ? this.ok(res, updated) : this.error(res, "Could not reschedule booking.");
    } catch (error) {
      if (error instanceof z.ZodError) {
        return this.badRequest(res, error.errors.map((err) => err.message).join(". "));
      }
      return this.error(res, "Unable to reschedule booking. Please try again.");
    }
  }
}
