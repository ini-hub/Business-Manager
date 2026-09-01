import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    updateUser: vi.fn(),
    getUserByIdentifier: vi.fn(),
    getAllStaffByUserId: vi.fn(),
    updateStaff: vi.fn(),
  },
  serializeUser: (u: any) => u,
}));
vi.mock("../email", () => ({
  sendEmailVerificationOtpEmail: vi.fn(),
  sendEmailChangeNoticeToOldAddress: vi.fn(),
  sendSMS: vi.fn(),
}));

import { AuthController } from "./AuthController";
import { storage } from "../storage";

const S = storage as any;
const controller = new AuthController() as any;

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.sendStatus = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthController - identity sync with linked staff rows", () => {
  it("updateProfile mirrors a changed name onto every linked staff row", async () => {
    S.updateUser.mockResolvedValue({ id: "user-1", name: "Folakemi" });
    S.getAllStaffByUserId.mockResolvedValue([
      { id: "staff-1", storeId: "store-1" },
      { id: "staff-2", storeId: "store-2" },
    ]);

    const req: any = { user: { id: "user-1" }, body: { name: "Folakemi" } };
    const res = mockRes();

    await controller.updateProfile(req, res);

    expect(S.updateUser).toHaveBeenCalledWith("user-1", { name: "Folakemi", profilePhotoUrl: undefined });
    expect(S.getAllStaffByUserId).toHaveBeenCalledWith("user-1");
    expect(S.updateStaff).toHaveBeenCalledWith("staff-1", { name: "Folakemi" });
    expect(S.updateStaff).toHaveBeenCalledWith("staff-2", { name: "Folakemi" });
  });

  it("updateProfile does not touch staff rows when name is not part of the request", async () => {
    S.updateUser.mockResolvedValue({ id: "user-1", profilePhotoUrl: "x" });

    const req: any = { user: { id: "user-1" }, body: { profilePhotoUrl: "x" } };
    const res = mockRes();

    await controller.updateProfile(req, res);

    expect(S.getAllStaffByUserId).not.toHaveBeenCalled();
    expect(S.updateStaff).not.toHaveBeenCalled();
  });

  it("verifyEmailChange mirrors the newly-confirmed email onto every linked staff row", async () => {
    S.getUser.mockResolvedValue({
      id: "user-1",
      pendingEmail: "new@example.com",
      pendingEmailOtp: "123456",
      pendingEmailOtpAttempts: 0,
      pendingEmailOtpExpiry: new Date(Date.now() + 60_000),
    });
    S.getUserByIdentifier.mockResolvedValue(undefined); // address not claimed by anyone else
    S.updateUser.mockResolvedValue({ id: "user-1", email: "new@example.com" });
    S.getAllStaffByUserId.mockResolvedValue([{ id: "staff-1", storeId: "store-1" }]);

    const req: any = { user: { id: "user-1" }, body: { otp: "123456" } };
    const res = mockRes();

    await controller.verifyEmailChange(req, res);

    expect(S.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ email: "new@example.com" }));
    expect(S.getAllStaffByUserId).toHaveBeenCalledWith("user-1");
    expect(S.updateStaff).toHaveBeenCalledWith("staff-1", { email: "new@example.com" });
  });

  it("verifyEmailChange never reaches the staff sync when the OTP is wrong", async () => {
    S.getUser.mockResolvedValue({
      id: "user-1",
      pendingEmail: "new@example.com",
      pendingEmailOtp: "123456",
      pendingEmailOtpAttempts: 0,
      pendingEmailOtpExpiry: new Date(Date.now() + 60_000),
    });

    const req: any = { user: { id: "user-1" }, body: { otp: "000000" } };
    const res = mockRes();

    await controller.verifyEmailChange(req, res);

    expect(S.updateUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ pendingEmailOtpAttempts: 1 }));
    expect(S.getAllStaffByUserId).not.toHaveBeenCalled();
    expect(S.updateStaff).not.toHaveBeenCalled();
  });
});
