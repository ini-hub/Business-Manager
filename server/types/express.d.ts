import type { JWTPayload } from "../auth";
import type { AdminJWTPayload } from "../auth-admin";

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      admin?: AdminJWTPayload;
    }
  }
}
