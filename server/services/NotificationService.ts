import { storage } from "../storage";
import { broadcastNotification as wsBroadcast } from "../websocket";

export class NotificationService {
  public async getNotifications(userId: string): Promise<any[]> {
    return await storage.getNotifications(userId);
  }

  public async markAsRead(id: string): Promise<void> {
    await storage.markNotificationAsRead(id);
  }

  public async markAllAsRead(userId: string): Promise<void> {
    await storage.markAllNotificationsAsRead(userId);
  }

  public async createNotification(data: {
    userId: string;
    title: string;
    message: string;
    type: string;
  }): Promise<any> {
    const notification = await storage.createNotification(data);
    return notification;
  }

  public broadcast(businessId: string, payload: any): void {
    wsBroadcast(businessId, payload);
  }
}

export const notificationService = new NotificationService();
