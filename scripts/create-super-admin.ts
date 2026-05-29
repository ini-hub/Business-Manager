import bcrypt from "bcrypt";
import { db } from "../server/db";
import { superAdmins } from "../shared/schema";
import { generateSecret, getOTPAuthURL } from "../server/totp";
import { eq } from "drizzle-orm";

async function createSuperAdmin() {
  const name = process.argv[2] || "CEO Super Admin";
  const email = process.argv[3] || "superadmin@businessmanager.com";
  const password = process.argv[4] || "SuperAdminPassword123!";
  const role = process.argv[5] || "super_admin"; // 'super_admin' | 'ops_manager' | 'support_agent' | 'finance_admin'

  console.log("=== Business Manager Administrative CLI ===");
  console.log(`Preparing to provision administrative account:`);
  console.log(`- Name:     ${name}`);
  console.log(`- Email:    ${email}`);
  console.log(`- Role:     ${role}`);
  console.log(`- Password: [MASKED] (${password})`);
  console.log("-------------------------------------------");

  if (!email.includes("@")) {
    console.error("Error: Please provide a valid email address.");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("Error: Password must be at least 8 characters long.");
    process.exit(1);
  }

  try {
    // Check if admin already exists
    const [existing] = await db
      .select()
      .from(superAdmins)
      .where(eq(superAdmins.email, email.trim().toLowerCase()))
      .limit(1);

    if (existing) {
      console.error(`Error: Administrative account with email '${email}' already exists.`);
      process.exit(1);
    }

    // Hash password
    console.log("Hashing password...");
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate Base32 MFA secret
    console.log("Generating TOTP MFA Secret...");
    const mfaSecret = generateSecret();
    const pairingUrl = getOTPAuthURL(email.trim().toLowerCase(), "BusinessManager-Admin", mfaSecret);

    // Insert to DB
    console.log("Inserting administrative record into the database...");
    const [newAdmin] = await db
      .insert(superAdmins)
      .values({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        mfaSecret,
        mfaEnabled: true, // Seeding prompts immediately for MFA setup
        role: role as any,
        status: "active",
      })
      .returning();

    console.log("\n===========================================");
    console.log("SUCCESS: Administrative account provisioned!");
    console.log("===========================================");
    console.log(`ID:           ${newAdmin.id}`);
    console.log(`Name:         ${newAdmin.name}`);
    console.log(`Email:        ${newAdmin.email}`);
    console.log(`Role:         ${newAdmin.role}`);
    console.log(`MFA Secret:   ${mfaSecret}`);
    console.log("\nScan the URI below or enter the MFA Secret in Google Authenticator / Authy:");
    console.log(`\nPairing URL:  ${pairingUrl}\n`);
    console.log("Use this account to log into the Super Admin Portal.");
    console.log("===========================================\n");
  } catch (error) {
    console.error("Fatal Error provisioning admin account:", error);
    process.exit(1);
  }
}

createSuperAdmin().then(() => process.exit(0));
