import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import { creditEntries } from "@shared/schema";
import { eq } from "drizzle-orm";

export class CreditController extends BaseController {
  public register(router: Router): void {
    router.get("/credit/summary", isAuthenticated, this.getCreditSummary.bind(this));
    router.get("/credit/ledger", isAuthenticated, this.getCreditLedger.bind(this));
    router.post("/credit/entries", isAuthenticated, this.createCreditEntry.bind(this));
    router.post("/credit/entries/:id/repayments", isAuthenticated, this.createRepayment.bind(this));
    router.get("/credit/entries/:id/repayments", isAuthenticated, this.getRepayments.bind(this));
    router.post("/credit/entries/:id/reminders", isAuthenticated, this.sendReminder.bind(this));
    router.get("/credit/entries/:id/reminders", isAuthenticated, this.getReminderLogs.bind(this));
    router.post("/credit/entries/:id/write-off", isAuthenticated, this.writeOffDebt.bind(this));
    router.get("/credit/reports", isAuthenticated, this.getBorrowBookReport.bind(this));
  }

  private async getCreditSummary(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please select a store first.");
      }

      if (storeId === "all") {
        const stores = await this.getUserStores(req);
        if (stores.length === 0) {
          return this.ok(res, {
            totalOwed: 0,
            totalOwedCount: 0,
            totalOverdue: 0,
            totalOverdueCount: 0,
            totalDueThisWeek: 0,
            totalDueThisWeekCount: 0,
            totalCollectedThisMonth: 0,
          });
        }
        const summaries = await Promise.all(
          stores.map(s => storage.creditRepo.getCreditSummary(s.id))
        );
        const combined = {
          totalOwed: summaries.reduce((sum, s) => sum + s.totalOwed, 0),
          totalOwedCount: summaries.reduce((sum, s) => sum + s.totalOwedCount, 0),
          totalOverdue: summaries.reduce((sum, s) => sum + s.totalOverdue, 0),
          totalOverdueCount: summaries.reduce((sum, s) => sum + s.totalOverdueCount, 0),
          totalDueThisWeek: summaries.reduce((sum, s) => sum + s.totalDueThisWeek, 0),
          totalDueThisWeekCount: summaries.reduce((sum, s) => sum + s.totalDueThisWeekCount, 0),
          totalCollectedThisMonth: summaries.reduce((sum, s) => sum + s.totalCollectedThisMonth, 0),
        };
        return this.ok(res, combined);
      }

      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const summary = await storage.creditRepo.getCreditSummary(storeId);
      return this.ok(res, summary);
    } catch (e) {
      console.error("Credit summary controller error:", e);
      return this.error(res, "Could not load credit summary. Please try again.");
    }
  }

  private async getCreditLedger(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please select a store first.");
      }

      const status = req.query.status ? (req.query.status as string).split(",") : undefined;
      const minOutstanding = req.query.minOutstanding ? parseFloat(req.query.minOutstanding as string) : undefined;
      const maxOutstanding = req.query.maxOutstanding ? parseFloat(req.query.maxOutstanding as string) : undefined;
      const customerId = req.query.customerId as string;
      const search = req.query.search as string;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (storeId === "all") {
        const stores = await this.getUserStores(req);
        if (stores.length === 0) return this.ok(res, []);

        const responses = await Promise.all(
          stores.map(async (s) => {
            const list = await storage.creditRepo.getCreditLedger(s.id, {
              status,
              minOutstanding,
              maxOutstanding,
              customerId,
              search,
              startDate,
              endDate,
            });
            return list.map(item => ({ ...item, storeName: s.name }));
          })
        );
        const merged = responses.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return this.ok(res, merged);
      }

      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const ledger = await storage.creditRepo.getCreditLedger(storeId, {
        status,
        minOutstanding,
        maxOutstanding,
        customerId,
        search,
        startDate,
        endDate,
      });

      return this.ok(res, ledger);
    } catch (e) {
      console.error("Credit ledger controller error:", e);
      return this.error(res, "Could not load credit ledger. Please try again.");
    }
  }

  private async createCreditEntry(req: Request, res: Response): Promise<Response> {
    try {
      const { storeId, customerId, amountOwed, amountPaidUpfront, dueDate, description, notes, linkedTransactionId } = req.body;
      if (!storeId || !customerId || amountOwed === undefined) {
        return this.badRequest(res, "Required fields are missing.");
      }
      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const outstandingBalance = amountOwed - (amountPaidUpfront || 0);
      const status = outstandingBalance <= 0 ? "settled" : "owing";

      const entry = await storage.creditRepo.createCreditEntry({
        storeId,
        customerId,
        amountOwed,
        amountPaidUpfront: amountPaidUpfront || 0,
        outstandingBalance,
        dueDate: dueDate ? new Date(dueDate) : null,
        description,
        notes,
        status,
        linkedTransactionId: linkedTransactionId || null,
      });

      // When converting an existing transaction to credit, update its payment method so
      // it shows as "credit" in transaction history and is no longer ambiguously "pending"
      if (linkedTransactionId) {
        await storage.updateCheckoutPaymentMethod(linkedTransactionId, "credit", "pending");
      }

      return this.created(res, entry);
    } catch (e) {
      console.error("Create credit entry controller error:", e);
      return this.error(res, "Could not create credit entry. Please try again.");
    }
  }

  private async createRepayment(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { amountReceived, paymentMethod, notes } = req.body;

      if (amountReceived === undefined || amountReceived <= 0) {
        return this.badRequest(res, "Amount received must be greater than 0.");
      }

      const entry = await storage.creditRepo.findById(id);
      if (!entry) {
        return this.notFound(res, "Credit entry not found.");
      }

      if (!(await this.checkStoreAccess(entry.storeId, req, res))) return res;

      if (amountReceived > entry.outstandingBalance) {
        return this.badRequest(res, `Amount exceeds outstanding balance of ₦${entry.outstandingBalance.toLocaleString()}`);
      }

      const staffMember = await storage.getStaffByUserId((req as any).user?.userId || (req as any).user?.id);

      const repayment = await storage.creditRepo.createRepayment({
        creditEntryId: id,
        amountReceived,
        paymentMethod: paymentMethod || "cash",
        notes,
        recordedByStaffId: staffMember?.id || null,
      });

      return this.created(res, repayment);
    } catch (e) {
      console.error("Record repayment controller error:", e);
      return this.error(res, "Could not record repayment. Please try again.");
    }
  }

  private async getRepayments(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const entry = await storage.creditRepo.findById(id);
      if (!entry) {
        return this.notFound(res, "Credit entry not found.");
      }
      if (!(await this.checkStoreAccess(entry.storeId, req, res))) return res;

      const repaymentsList = await storage.creditRepo.getRepayments(id);
      return this.ok(res, repaymentsList);
    } catch (e) {
      console.error("Get repayments controller error:", e);
      return this.error(res, "Could not load repayments. Please try again.");
    }
  }

  private async getReminderLogs(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const entry = await storage.creditRepo.findById(id);
      if (!entry) {
        return this.notFound(res, "Credit entry not found.");
      }
      if (!(await this.checkStoreAccess(entry.storeId, req, res))) return res;

      const logs = await storage.creditRepo.getReminderLogs(id);
      return this.ok(res, logs);
    } catch (e) {
      console.error("Get reminder logs controller error:", e);
      return this.error(res, "Could not load reminder logs. Please try again.");
    }
  }

  private async sendReminder(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { channel } = req.body; // whatsapp, sms

      if (!channel) {
        return this.badRequest(res, "Channel is required.");
      }

      // Load full ledger record to gather customer data
      const entry = await storage.creditRepo.findById(id);
      if (!entry) {
        return this.notFound(res, "Credit entry not found.");
      }
      if (!(await this.checkStoreAccess(entry.storeId, req, res))) return res;

      const customer = await storage.getCustomer(entry.customerId);
      if (!customer) {
        return this.notFound(res, "Linked customer not found.");
      }

      const storeSettings = await storage.getSettings(entry.storeId);
      const store = await storage.getStore(entry.storeId);
      const businessName = store?.name || "Our Store";

      const language = storeSettings?.borrowBookReminderLanguage || "both";
      const isOverdue = entry.status === "overdue" || (entry.dueDate && new Date(entry.dueDate) < new Date());
      const formatNumber = (num: number) => num.toLocaleString();
      const formattedDate = entry.dueDate ? new Date(entry.dueDate).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";

      let message = "";

      if (language === "pidgin") {
        if (isOverdue) {
          message = `Hello ${customer.name},\n\nYour balance of ₦${formatNumber(entry.outstandingBalance)} for ${businessName} don pass the due date wey una agree.\n\nAbeg reach us make we sort am out.\nWe appreciate your business! 🙏`;
        } else {
          message = `Hello ${customer.name}! 👋\n\nThis na ${businessName}.\nYou get balance of ₦${formatNumber(entry.outstandingBalance)} wey due on ${formattedDate}.\n\nIf you don pay already, abeg ignore this message.\nIf not, make you try settle before the date.\n\nThank you! 🙏`;
        }
      } else {
        // English
        if (isOverdue) {
          message = `Hello ${customer.name},\n\nThis is a reminder from ${businessName}.\nYour balance of ₦${formatNumber(entry.outstandingBalance)} has passed its agreed due date.\n\nPlease contact us as soon as possible to sort this out.\nThank you! 🙏`;
        } else {
          message = `Hello ${customer.name},\n\nThis is a reminder from ${businessName}.\nYou have an outstanding balance of ₦${formatNumber(entry.outstandingBalance)} due on ${formattedDate}.\n\nPlease arrange payment before the due date.\nThank you! 🙏`;
        }
      }

      if (!customer.mobileNumber) {
        return this.badRequest(res, "No phone number on file — reminders unavailable.");
      }

      // Simulated gateway delivery success log
      const log = await storage.creditRepo.logReminder({
        creditEntryId: id,
        channel,
        type: "manual",
        status: "sent",
        messageContent: message,
      });

      return this.ok(res, { success: true, log });
    } catch (e) {
      console.error("Send reminder controller error:", e);
      return this.error(res, "Could not send reminder. Please try again.");
    }
  }

  private async writeOffDebt(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return this.badRequest(res, "Reason is required.");
      }

      const entry = await storage.creditRepo.findById(id);
      if (!entry) {
        return this.notFound(res, "Credit entry not found.");
      }

      if (!(await this.checkStoreAccess(entry.storeId, req, res))) return res;

      // Verify user role is owner
      const userRole = (req as any).user?.role;
      if (userRole !== "owner") {
        return this.forbidden(res, "Only business owners can authorize debt write-offs.");
      }

      const updated = await storage.creditRepo.writeOffDebt(id, reason);
      return this.ok(res, updated);
    } catch (e) {
      console.error("Write-off controller error:", e);
      return this.error(res, "Could not write off debt. Please try again.");
    }
  }

  private async getBorrowBookReport(req: Request, res: Response): Promise<Response> {
    try {
      const storeId = req.query.storeId as string;
      if (!storeId) {
        return this.badRequest(res, "Please select a store first.");
      }

      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (storeId === "all") {
        const stores = await this.getUserStores(req);
        if (stores.length === 0) {
          return this.ok(res, {
            totalExtended: 0,
            totalCollected: 0,
            collectionRate: 100,
            totalWrittenOff: 0,
            aging: { zeroToSeven: 0, eightToThirty: 0, thirtyOneToSixty: 0, sixtyPlus: 0 },
            topOwing: [],
          });
        }

        const reports = await Promise.all(
          stores.map(s => storage.creditRepo.getBorrowBookReport(s.id, startDate, endDate))
        );

        const aging = {
          zeroToSeven: reports.reduce((sum, r) => sum + r.aging.zeroToSeven, 0),
          eightToThirty: reports.reduce((sum, r) => sum + r.aging.eightToThirty, 0),
          thirtyOneToSixty: reports.reduce((sum, r) => sum + r.aging.thirtyOneToSixty, 0),
          sixtyPlus: reports.reduce((sum, r) => sum + r.aging.sixtyPlus, 0),
        };

        const totalExtended = reports.reduce((sum, r) => sum + r.totalExtended, 0);
        const totalCollected = reports.reduce((sum, r) => sum + r.totalCollected, 0);
        const totalWrittenOff = reports.reduce((sum, r) => sum + r.totalWrittenOff, 0);
        const collectionRate = totalExtended > 0 ? (totalCollected / totalExtended) * 100 : 100;

        const customerMap: Record<string, { name: string; phone: string; balance: number }> = {};
        for (const r of reports) {
          for (const c of (r.topOwing || [])) {
            const key = c.phone || c.name;
            if (!customerMap[key]) {
              customerMap[key] = { name: c.name, phone: c.phone, balance: 0 };
            }
            customerMap[key].balance += c.balance;
          }
        }
        const topOwing = Object.values(customerMap)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 5);

        return this.ok(res, {
          totalExtended,
          totalCollected,
          collectionRate,
          totalWrittenOff,
          aging,
          topOwing,
        });
      }

      if (!(await this.checkStoreAccess(storeId, req, res))) return res;

      const report = await storage.creditRepo.getBorrowBookReport(storeId, startDate, endDate);
      return this.ok(res, report);
    } catch (e) {
      console.error("Get Borrow Book report controller error:", e);
      return this.error(res, "Could not load report. Please try again.");
    }
  }
}
