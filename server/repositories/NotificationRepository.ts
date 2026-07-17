import { db } from "../db";
import {
  notifications,
  users,
  stores,
  staff,
  type Notification,
  type InsertNotification,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { broadcastNotification } from "../websocket";

export class NotificationRepository {
  async getNotifications(userId: string): Promise<Notification[]> {
    return db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  async markNotificationAsRead(id: string, userId: string): Promise<boolean> {
    const updated = await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning({ id: notifications.id });
    return updated.length > 0;
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(data).returning();

    try {
      // Resolve the businessId so the broadcast is scoped to the correct tenant
      let businessId: string | null = null;

      if (data.storeId) {
        const [store] = await db.select({ businessId: stores.businessId }).from(stores).where(eq(stores.id, data.storeId)).limit(1);
        businessId = store?.businessId ?? null;
      }

      if (!businessId) {
        const [user] = await db.select({ businessId: users.businessId }).from(users).where(eq(users.id, data.userId)).limit(1);
        businessId = user?.businessId ?? null;
      }

      if (businessId) {
        broadcastNotification(businessId, notification);
      }
    } catch (err) {
      console.error("Failed to broadcast notification over WebSocket:", err);
    }

    return notification;
  }

  async notifyManagers(storeId: string, type: string, message: string): Promise<void> {
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
    if (!store) return;

    // Owners oversee the whole business, so they're notified for every store.
    // Managers are scoped to the store they're assigned to (stores.managerStaffId),
    // not every manager in the business.
    const owners = await db.select({ id: users.id }).from(users).where(
      and(eq(users.businessId, store.businessId), eq(users.role, "owner"))
    );

    const recipientIds = new Set(owners.map((owner) => owner.id));

    if (store.managerStaffId) {
      const [manager] = await db.select({ userId: staff.userId })
        .from(staff)
        .where(eq(staff.id, store.managerStaffId));
      if (manager?.userId) recipientIds.add(manager.userId);
    }

    for (const userId of Array.from(recipientIds)) {
      await this.createNotification({
        storeId,
        userId,
        type,
        message,
      });
    }
  }
}
