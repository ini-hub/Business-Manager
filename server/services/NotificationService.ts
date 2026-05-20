import { storage } from "../storage";
import { broadcastNotification as wsBroadcast } from "../websocket";

export class NotificationService {
  /**
   * Loads all notifications for a specific user
   */
  public async getNotifications(userId: string): Promise<any[]> {
    return await storage.getNotifications(userId);
  }

  /**
   * Marks a specific notification as read
   */
  public async markAsRead(id: string): Promise<void> {
    await storage.markNotificationAsRead(id);
  }

  /**
   * Marks all notifications for a user as read
   */
  public async markAllAsRead(userId: string): Promise<void> {
    await storage.markAllNotificationsAsRead(userId);
  }

  /**
   * Creates a notification in the database and broadcasts it in real-time
   */
  public async createNotification(data: {
    userId: string;
    title: string;
    message: string;
    type: string;
  }): Promise<any> {
    const notification = await storage.createNotification(data);
    return notification;
  }

  /**
   * Directly broadcasts a message to all connected websocket clients
   */
  public broadcast(payload: any): void {
    wsBroadcast(payload);
  }
}

export const notificationService = new NotificationService();
