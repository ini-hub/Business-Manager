import type { Request, Response } from "express";
import { storage } from "../storage";
import { generateToken, generateOrgSelectToken, generateContractPendingToken } from "../auth";
import { staffContractService } from "../services/StaffContractService";
import { broadcastDataChange } from "../websocket";

/**
 * The "resolve org membership(s) -> org_select or issue jwt_token" tail of
 * POST /api/auth/login, extracted so it can be called both from the normal
 * login path (once the legal-document consent gate has already passed) and
 * from POST /api/legal/consent-pending/accept (server/routes/legal.routes.ts),
 * once a previously-unconsented user accepts and login can finally proceed.
 * Never throws - callers are expected to run this inside their own try/catch.
 */
export async function completeLoginForUser(user: any, req: Request, res: Response): Promise<void> {
  // Fetch user organizations
  const members = await storage.getOrganisationsByUserId(user.id);
  const activeMembers = members.filter((m: any) => m.status === "active");

  if (activeMembers.length === 0) {
    // Before the generic "no active organisation" 403: this account's
    // password is already set (we got this far), but a membership is
    // sitting in "contract_pending" - see completeStaffActivation below.
    // Covers "closed the tab after setting the password, came back and
    // logged in normally" rather than dead-ending them.
    const contractPendingMember = members.find((m: any) => m.status === "contract_pending");
    if (contractPendingMember) {
      const allStaff = await storage.getAllStaffByUserId(user.id);
      let staffForOrg;
      for (const s of allStaff) {
        const store = await storage.getStore(s.storeId);
        if (store?.businessId === contractPendingMember.organisationId) {
          staffForOrg = s;
          break;
        }
      }
      const contract = staffForOrg ? await staffContractService.getContractByStaffId(staffForOrg.id) : undefined;

      if (contract?.status === "declined") {
        // Distinct from the generic message below on purpose - a declined
        // contract needs the manager's attention, not another login attempt.
        res.status(403).json({
          error: "You declined this contract. Your manager has been notified — contact them to proceed.",
          status: "contract_declined",
        });
        return;
      }
      if (contract?.status === "pending_signature") {
        const pendingToken = generateContractPendingToken(user.id, contract.id);
        res.cookie("contract_pending_token", pendingToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60 * 1000,
          sameSite: "lax",
        });
        res.json({
          status: "contract_signature_required",
          nextStep: "sign-contract",
          message: "Please review and sign your contract to continue.",
        });
        return;
      }
    }

    res.status(403).json({ error: "Your account is not associated with any active organisation." });
    return;
  }

  // If user belongs to multiple organizations, let them choose
  if (activeMembers.length > 1) {
    const orgIds = activeMembers.map((m: any) => m.organisationId);
    const orgs = await storage.getBusinessesByIds(orgIds);
    const orgMap = new Map(orgs.map((o: any) => [o.id, o]));
    const orgList = activeMembers
      .map((m: any) => {
        const org = orgMap.get(m.organisationId);
        if (!org) return null;
        return { id: org.id, name: org.name, slug: org.slug, role: m.role };
      })
      .filter(Boolean);
    res.json({
      requiresOrganisationSelection: true,
      organisations: orgList,
      orgSelectToken: generateOrgSelectToken(user.id),
    });
    return;
  }

  // Single organization path - scope JWT immediately
  const activeMember = activeMembers[0];
  const org = await storage.getBusinessById(activeMember.organisationId);

  const payload = {
    userId: user.id,
    organisationId: activeMember.organisationId,
    role: activeMember.role,
    staffId: activeMember.staffId || undefined,
    email: user.email || undefined,
  };

  const token = generateToken(payload);

  res.cookie("jwt_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "lax",
  });

  const sessionUser = {
    id: user.id,
    email: user.email || user.phone || "",
    role: activeMember.role,
    businessId: activeMember.organisationId,
    isVerified: user.isVerified || user.isEmailVerified || user.isPhoneVerified,
  };

  (req as any).user = payload;

  res.json({
    message: "Login successful.",
    user: sessionUser,
    business: org,
  });
}

/**
 * The "resolve workspace membership -> contract check -> issue jwt_token"
 * tail of POST /api/auth/set-activated-password, extracted for the same
 * reason as completeLoginForUser above: it now runs both inline (once the
 * legal-document consent gate has already passed) and from
 * POST /api/legal/consent-pending/accept once a first-time staff activation
 * accepts. Assumes the caller has already set the account's password.
 */
export async function completeStaffActivation(user: any, res: Response): Promise<void> {
  const members = await storage.getOrganisationsByUserId(user.id);
  let targetMember = members.find((m: any) => m.status === "partial") || members.find((m: any) => m.status === "pending")
    || members.find((m: any) => m.status === "contract_pending") || members.find((m: any) => m.status === "active");
  if (!targetMember) {
    res.status(400).json({ error: "No workspace association found." });
    return;
  }

  // Both users.name and staff.name are seeded from the manager's own input
  // at invite time (StaffInviteService.createInvitedUser) and are
  // deliberately NOT writable from here - see the equivalent comment that
  // used to live inline in server/routes.ts POST /api/auth/set-activated-password.
  const activatedStaff = await storage.getStaffByUserId(user.id);

  // If this staff member has a contract, this is a first-time activation
  // (targetMember has never been "active" before), so the gate applies -
  // see migrations/0046_staff_contract_signing.sql. Only the SESSION is
  // gated on contract state (and, ahead of this, on legal-document consent
  // - see the caller). Checked here via the unfiltered getContractByStaffId
  // (not getPendingContract, which only returns pending_signature rows and
  // therefore looks identical to "no contract" for a declined one) - a
  // declined contract must be handled explicitly, the same way
  // completeLoginForUser above does, or it can be silently bypassed.
  const contract = activatedStaff && targetMember.status !== "active"
    ? await staffContractService.getContractByStaffId(activatedStaff.id)
    : undefined;

  if (contract?.status === "declined") {
    res.status(403).json({
      error: "You declined this contract. Your manager has been notified — contact them to proceed.",
      status: "contract_declined",
    });
    return;
  }

  if (contract?.status === "pending_signature") {
    targetMember = await storage.updateOrganisationMemberStatus(targetMember.memberId || targetMember.id, "contract_pending");
    broadcastDataChange(targetMember.organisationId, "staff", activatedStaff?.storeId, "updated");

    const pendingToken = generateContractPendingToken(user.id, contract.id);
    res.cookie("contract_pending_token", pendingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
      sameSite: "lax",
    });

    res.json({
      message: "Password set. Please review and sign your contract to continue.",
      nextStep: "sign-contract",
    });
    return;
  }

  if (targetMember.status !== "active") {
    targetMember = await storage.updateOrganisationMemberStatus(targetMember.memberId || targetMember.id, "active", new Date());
  }

  // Not authenticated yet (no req.user), so use broadcastDataChange directly
  // rather than the req-based broadcastChange helper.
  broadcastDataChange(targetMember.organisationId, "staff", activatedStaff?.storeId, "updated");

  const org = await storage.getBusinessById(targetMember.organisationId);

  const payload = {
    userId: user.id,
    organisationId: targetMember.organisationId,
    role: targetMember.role,
    staffId: targetMember.staffId || undefined,
    email: user.email || undefined,
  };

  const token = generateToken(payload);

  res.cookie("jwt_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "lax",
  });

  res.json({
    message: "Password set and logged in successfully.",
    user: {
      id: user.id,
      email: user.email || user.phone || "",
      role: targetMember.role,
      businessId: targetMember.organisationId,
      isVerified: true,
    },
    business: org,
  });
}
