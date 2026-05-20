import { Router, Request, Response } from "express";
import { BaseController } from "./BaseController";
import { storage } from "../storage";
import { isAuthenticated } from "../auth";
import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

export class AuthController extends BaseController {
  public register(router: Router): void {
    // Health check
    router.get("/health", this.healthCheck.bind(this));

    // Profile updates
    router.patch("/auth/user/profile", isAuthenticated, this.updateProfile.bind(this));
    router.post("/auth/user/change-password", isAuthenticated, this.changePassword.bind(this));
  }

  private healthCheck(req: Request, res: Response): Response {
    return this.ok(res, { status: "ok", timestamp: new Date().toISOString() });
  }

  private async updateProfile(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { name, profilePhotoUrl } = req.body;
      const updated = await storage.updateUser(userId, { name, profilePhotoUrl });
      return this.ok(res, updated);
    } catch (error) {
      return this.error(res, "Could not update profile.");
    }
  }

  private async changePassword(req: Request, res: Response): Promise<Response> {
    try {
      const userId = (req as any).user.id;
      const { currentPassword, newPassword } = req.body;
      
      const user = await storage.getUser(userId);
      if (!user) return this.notFound(res, "User not found.");

      const isMatch = user.password ? await bcrypt.compare(currentPassword, user.password) : false;
      if (!isMatch) return this.badRequest(res, "Incorrect current password.");

      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await storage.updateUser(userId, { password: hashedPassword });
      
      return this.ok(res, { message: "Password updated successfully." });
    } catch (error) {
      return this.error(res, "Could not change password.");
    }
  }
}
