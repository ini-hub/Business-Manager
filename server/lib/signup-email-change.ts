// Who may swap the email on a signup that has not been verified yet. There is
// no session at this point, so the endpoint also demands the account password;
// this module is only the eligibility rule so it can be unit-tested.
import { isManagerEmailChangePending } from "./email-change-gate";

export type SignupEmailChangeVerdict = "ok" | "not_eligible" | "same_email";

interface Candidate {
  email?: string | null;
  isEmailVerified?: boolean | null;
  createdByInvitation?: boolean | null;
  managerEmailChangedAt?: Date | string | null;
}

export function checkSignupEmailChange(
  user: Candidate | null | undefined,
  currentEmail: string,
  newEmail: string,
): SignupEmailChangeVerdict {
  if (!user || (user.email ?? "").toLowerCase() !== currentEmail.toLowerCase()) return "not_eligible";
  // Verified owners change email from settings; invited staff are fixed by their manager.
  if (user.isEmailVerified || user.createdByInvitation) return "not_eligible";
  if (isManagerEmailChangePending(user)) return "not_eligible";
  if (currentEmail.toLowerCase() === newEmail.toLowerCase()) return "same_email";
  return "ok";
}
