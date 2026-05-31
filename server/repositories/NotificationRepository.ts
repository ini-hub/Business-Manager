import { db } from "../db";
import {
  notifications,
  users,
  stores,
  type Notification,
  type InsertNotification,
} from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { broadcastNotification } from "../websocket";

export class NotificationRepository {
  async getNotifications(userId: string): Promise<Notification[]> {
    return db.select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  async markNotificationAsRead(id: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [notification] = await db.insert(notifications).values(data).returning();

    try {
      broadcastNotification(notification);
    } catch (err) {
      console.error("Failed to broadcast notification over WebSocket:", err);
    }

    return notification;
  }

  async notifyManagers(storeId: string, type: string, message: string): Promise<void> {
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
    if (!store) return;

    const managers = await db.select().from(users).where(
      and(
        eq(users.businessId, store.businessId),
        or(eq(users.role, "owner"), eq(users.role, "manager"))
      )
    );

    for (const mgr of managers) {
      await this.createNotification({
        storeId,
        userId: mgr.id,
        type,
        message,
      });
    }
  }
}
