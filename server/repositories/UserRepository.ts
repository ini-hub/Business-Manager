import { BaseRepository } from "./BaseRepository";
import { db } from "../db";
import { users, type User, type UpsertUser, type UserRole } from "@shared/schema";
import { eq, and, or, gt } from "drizzle-orm";

export class UserRepository extends BaseRepository<typeof users> {
  constructor() {
    super(users);
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.findById(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.phone, phone));
    return user;
  }

  async getUserByIdentifier(emailOrPhone: string): Promise<User | undefined> {
    const clean = emailOrPhone.trim().toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.email, clean), eq(users.phone, clean)));
    return user;
  }

  async getUserByActivationCode(code: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.activationCode, code),
          eq(users.activationCodeUsed, false),
          gt(users.activationCodeExpiry, new Date())
        )
      );
    return user;
  }

  async createUser(userData: {
    email: string;
    password: string;
    businessId: string;
    name?: string;
    phone?: string;
    role?: UserRole;
    isVerified?: boolean;
    activationCode?: string;
    activationCodeExpiry?: Date;
    activationCodeUsed?: boolean;
    createdByInvitation?: boolean;
  }): Promise<User> {
    const [user] = await db.insert(users).values({
      email: userData.email,
      password: userData.password,
      businessId: userData.businessId,
      name: userData.name,
      phone: userData.phone,
      role: userData.role || "owner",
      isVerified: userData.isVerified ?? false,
      activationCode: userData.activationCode,
      activationCodeExpiry: userData.activationCodeExpiry,
      activationCodeUsed: userData.activationCodeUsed ?? false,
      createdByInvitation: userData.createdByInvitation ?? false,
    }).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set({
      ...data,
      updatedAt: new Date(),
    }).where(eq(users.id, id)).returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }
}
