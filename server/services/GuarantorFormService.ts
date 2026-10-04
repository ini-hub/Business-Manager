import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { objectStorage } from "../lib/objectStorage";
import {
  hrGuarantorForms,
  hrGuarantorFormVersions,
  hrGuarantorFormDocuments,
  hrGuarantorFormSignatures,
  ALLOWED_GUARANTOR_DOC_MIME_TYPES,
  MAX_GUARANTOR_DOC_FILE_SIZE_BYTES,
  type InitiateGuarantorFormInput,
  type FillAndSignGuarantorFormInput,
  type HrGuarantorForm,
  type HrGuarantorFormVersion,
  type HrGuarantorFormDocument,
  type HrGuarantorFormSignature,
} from "@shared/schema";

type InitiateOutcome =
  | { kind: "initiated"; form: HrGuarantorForm; version: HrGuarantorFormVersion }
  | { kind: "refused_already_signed" }
  | { kind: "invalid"; reason: string };

type FillAndSignOutcome =
  | { kind: "signed"; form: HrGuarantorForm; signature: HrGuarantorFormSignature }
  | { kind: "not_awaiting_guarantor"; reason: string }
  | { kind: "invalid"; reason: string };

type DeclineOutcome =
  | { kind: "declined"; form: HrGuarantorForm }
  | { kind: "not_awaiting_guarantor"; reason: string };

/**
 * Owns the two-step guarantor form: initiate() is the employee submitting
 * Employee + Next of Kin data (server/routes/hr.routes.ts and
 * profile-completion.routes.ts); fillAndSign() is the actual guarantor,
 * reached only through the token link initiate() hands back, filling in
 * their own section and signing with a photographed signature image in one
 * atomic, one-time action (server/routes/guarantor.routes.ts). See
 * shared/schema/hr-guarantor.ts for the full status-lifecycle rationale.
 */
class GuarantorFormService {
  async getByStaffId(staffId: string): Promise<HrGuarantorForm | undefined> {
    const [row] = await db.select().from(hrGuarantorForms).where(eq(hrGuarantorForms.staffId, staffId));
    return row;
  }

  async getById(id: string): Promise<HrGuarantorForm | undefined> {
    const [row] = await db.select().from(hrGuarantorForms).where(eq(hrGuarantorForms.id, id));
    return row;
  }

  async getCurrentVersionWithDocuments(formId: string): Promise<{
    version: HrGuarantorFormVersion;
    documents: HrGuarantorFormDocument[];
  } | undefined> {
    const form = await this.getById(formId);
    if (!form?.currentVersionId) return undefined;
    const [version] = await db.select().from(hrGuarantorFormVersions).where(eq(hrGuarantorFormVersions.id, form.currentVersionId));
    if (!version) return undefined;
    const documents = await db.select().from(hrGuarantorFormDocuments).where(eq(hrGuarantorFormDocuments.guarantorFormVersionId, version.id));
    return { version, documents };
  }

  /**
   * What the employee-side GuarantorTab.tsx hydrates its form from - without
   * this, the "Your Details (Employee)" / "Next of Kin" fields re-rendered
   * completely blank every time the page reloaded after a submission
   * (status "awaiting_guarantor"/"declined"), even though the data was
   * already saved, making it look like nothing had been kept. Projects only
   * the employee/next-of-kin/contact fields - never anything from the
   * guarantor's own section, which this same employee is never shown.
   */
  async getEmployeeSubmissionForStaff(staffId: string): Promise<{
    employee: InitiateGuarantorFormInput["employee"];
    nextOfKin: InitiateGuarantorFormInput["nextOfKin"];
    guarantorContactEmail: string;
    guarantorContactPhone: string;
    documents: Array<{ party: "employee" | "next_of_kin"; docType: string; storageKey: string; fileMimeType: string; fileSizeBytes: number; fileOriginalName: string }>;
  } | undefined> {
    const form = await this.getByStaffId(staffId);
    if (!form?.currentVersionId) return undefined;
    const current = await this.getCurrentVersionWithDocuments(form.id);
    if (!current) return undefined;
    const { version, documents } = current;

    const party = (prefix: "employee" | "nok") => ({
      title: (version as any)[`${prefix}Title`] ?? "",
      surname: (version as any)[`${prefix}Surname`] ?? "",
      otherNames: (version as any)[`${prefix}OtherNames`] ?? "",
      dob: (version as any)[`${prefix}Dob`] ?? "",
      nin: (version as any)[`${prefix}Nin`] ?? "",
      address: (version as any)[`${prefix}Address`] ?? "",
      addressCountry: (version as any)[`${prefix}AddressCountry`] ?? "",
      addressState: (version as any)[`${prefix}AddressState`] ?? "",
      addressCity: (version as any)[`${prefix}AddressCity`] ?? "",
      nearestBusStop: (version as any)[`${prefix}NearestBusStop`] ?? "",
      landmark: (version as any)[`${prefix}Landmark`] ?? "",
      mobile: (version as any)[`${prefix}Mobile`] ?? "",
      email: (version as any)[`${prefix}Email`] ?? "",
    });

    return {
      employee: party("employee"),
      nextOfKin: { ...party("nok"), relationship: version.nokRelationship ?? "" },
      guarantorContactEmail: form.guarantorContactEmail ?? "",
      guarantorContactPhone: form.guarantorContactPhone ?? "",
      documents: documents
        .filter((d) => d.party === "employee" || d.party === "next_of_kin")
        .map((d) => ({
          party: d.party as "employee" | "next_of_kin",
          docType: d.docType,
          storageKey: d.storageKey,
          fileMimeType: d.fileMimeType,
          fileSizeBytes: d.fileSizeBytes,
          fileOriginalName: d.fileOriginalName,
        })),
    };
  }

  // ─── Step 1: the employee submits Employee + Next of Kin data ─────────────

  async initiate(params: { staffId: string; createdByUserId: string; input: InitiateGuarantorFormInput }): Promise<InitiateOutcome> {
    const { staffId, createdByUserId, input } = params;
    let form = await this.getByStaffId(staffId);

    if (form?.status === "signed") {
      // A signed form is a completed legal record - the employee correcting
      // their own Employee/NOK data afterwards would silently change what
      // the guarantor actually reviewed and signed against. Amending a
      // signed form is a distinct, not-yet-built feature.
      return { kind: "refused_already_signed" };
    }

    for (const doc of input.documents) {
      const invalid = await this.validateDocument(doc);
      if (invalid) return { kind: "invalid", reason: invalid };
    }

    const result = await db.transaction(async (tx) => {
      if (!form) {
        const [created] = await tx.insert(hrGuarantorForms).values({ staffId, status: "awaiting_guarantor" }).returning();
        form = created;
      } else if (form.currentVersionId) {
        // Re-initiate before the guarantor has filled anything - supersede
        // the previous Employee/NOK-only version, same replace pattern as
        // StaffContractService.addReplacementVersion.
        await tx.update(hrGuarantorFormVersions).set({ supersededAt: new Date() }).where(eq(hrGuarantorFormVersions.id, form.currentVersionId));
      }

      const existingVersions = await tx.select({ id: hrGuarantorFormVersions.id }).from(hrGuarantorFormVersions).where(eq(hrGuarantorFormVersions.guarantorFormId, form!.id));
      const versionNumber = existingVersions.length + 1;

      const [version] = await tx.insert(hrGuarantorFormVersions).values({
        guarantorFormId: form!.id,
        versionNumber,
        employeeTitle: input.employee.title,
        employeeSurname: input.employee.surname,
        employeeOtherNames: input.employee.otherNames,
        employeeDob: input.employee.dob,
        employeeNin: input.employee.nin,
        employeeAddress: input.employee.address,
        employeeAddressCountry: input.employee.addressCountry || null,
        employeeAddressState: input.employee.addressState || null,
        employeeAddressCity: input.employee.addressCity || null,
        employeeNearestBusStop: input.employee.nearestBusStop,
        employeeLandmark: input.employee.landmark,
        employeeMobile: input.employee.mobile,
        employeeEmail: input.employee.email || null,
        nokTitle: input.nextOfKin.title,
        nokSurname: input.nextOfKin.surname,
        nokOtherNames: input.nextOfKin.otherNames,
        nokDob: input.nextOfKin.dob,
        nokNin: input.nextOfKin.nin,
        nokAddress: input.nextOfKin.address,
        nokAddressCountry: input.nextOfKin.addressCountry || null,
        nokAddressState: input.nextOfKin.addressState || null,
        nokAddressCity: input.nextOfKin.addressCity || null,
        nokNearestBusStop: input.nextOfKin.nearestBusStop,
        nokLandmark: input.nextOfKin.landmark,
        nokMobile: input.nextOfKin.mobile,
        nokEmail: input.nextOfKin.email || null,
        nokRelationship: input.nextOfKin.relationship,
        // Guarantor columns are deliberately left null here - only
        // fillAndSign ever writes them, and only once.
        eligibilityChecklist: {},
        contentHash: this.hashInitiation(input),
        createdByUserId,
      }).returning();

      if (input.documents.length > 0) {
        await tx.insert(hrGuarantorFormDocuments).values(
          input.documents.map((d) => ({
            guarantorFormVersionId: version.id,
            party: d.party,
            docType: d.docType,
            storageKey: d.storageKey,
            fileMimeType: d.fileMimeType,
            fileSizeBytes: d.fileSizeBytes,
            fileOriginalName: d.fileOriginalName,
          })),
        );
      }

      const [updatedForm] = await tx.update(hrGuarantorForms)
        .set({
          currentVersionId: version.id,
          status: "awaiting_guarantor",
          guarantorContactEmail: input.guarantorContactEmail,
          guarantorContactPhone: input.guarantorContactPhone || null,
          updatedAt: new Date(),
        })
        .where(eq(hrGuarantorForms.id, form!.id))
        .returning();

      return { form: updatedForm, version };
    });

    return { kind: "initiated", form: result.form, version: result.version };
  }

  // ─── Step 2: the guarantor fills their section and signs, once ────────────

  async fillAndSign(params: {
    guarantorFormId: string;
    input: FillAndSignGuarantorFormInput;
    ipAddress: string;
    userAgent: string;
  }): Promise<FillAndSignOutcome> {
    const { guarantorFormId, input, ipAddress, userAgent } = params;

    const form = await this.getById(guarantorFormId);
    if (!form || form.status !== "awaiting_guarantor" || !form.currentVersionId) {
      // Covers every case this must be structurally impossible to repeat:
      // already signed, declined, or (defensively) never initiated.
      return { kind: "not_awaiting_guarantor", reason: "This form is not awaiting the guarantor's signature - it may already have been signed, declined, or not yet been sent to you." };
    }
    const [version] = await db.select().from(hrGuarantorFormVersions).where(eq(hrGuarantorFormVersions.id, form.currentVersionId));
    if (!version) return { kind: "not_awaiting_guarantor", reason: "Form content is missing." };

    for (const doc of input.documents) {
      const invalid = await this.validateDocument(doc);
      if (invalid) return { kind: "invalid", reason: invalid };
    }
    const signatureInvalid = await this.validateDocument(input.signatureImage);
    if (signatureInvalid) return { kind: "invalid", reason: `Signature image: ${signatureInvalid}` };

    const contentHash = this.hashFullSubmission(version, input);

    const result = await db.transaction(async (tx) => {
      // The one and only write to guarantor_* columns for this form. The
      // "awaiting_guarantor" guard above is what makes this safe to run
      // without a lock: a second call can never observe the status it
      // requires, because this same transaction flips it to "signed" before
      // committing.
      await tx.update(hrGuarantorFormVersions).set({
        guarantorTitle: input.guarantor.title,
        guarantorSurname: input.guarantor.surname,
        guarantorOtherNames: input.guarantor.otherNames,
        guarantorDob: input.guarantor.dob,
        guarantorNin: input.guarantor.nin,
        guarantorAddress: input.guarantor.address,
        guarantorAddressCountry: input.guarantor.addressCountry || null,
        guarantorAddressState: input.guarantor.addressState || null,
        guarantorAddressCity: input.guarantor.addressCity || null,
        guarantorNearestBusStop: input.guarantor.nearestBusStop,
        guarantorLandmark: input.guarantor.landmark,
        guarantorMobile: input.guarantor.mobile,
        guarantorEmail: input.guarantor.email || null,
        guarantorBusinessName: input.guarantor.businessName,
        guarantorBusinessAddress: input.guarantor.businessAddress,
        guarantorOccupation: input.guarantor.occupation,
        guarantorJobGrade: input.guarantor.jobGrade,
        guarantorOfficialEmail: input.guarantor.officialEmail,
        eligibilityChecklist: input.eligibilityChecklist,
        contentHash,
      }).where(eq(hrGuarantorFormVersions.id, version.id));

      if (input.documents.length > 0) {
        await tx.insert(hrGuarantorFormDocuments).values(
          input.documents.map((d) => ({
            guarantorFormVersionId: version.id,
            party: d.party,
            docType: d.docType,
            storageKey: d.storageKey,
            fileMimeType: d.fileMimeType,
            fileSizeBytes: d.fileSizeBytes,
            fileOriginalName: d.fileOriginalName,
          })),
        );
      }

      const [signature] = await tx.insert(hrGuarantorFormSignatures).values({
        guarantorFormId: form.id,
        guarantorFormVersionId: version.id,
        staffId: form.staffId,
        printedFullName: input.printedFullName,
        signatureImageStorageKey: input.signatureImage.storageKey,
        signatureImageMimeType: input.signatureImage.fileMimeType,
        signatureImageSizeBytes: input.signatureImage.fileSizeBytes,
        yearsKnownEmployee: input.yearsKnownEmployee,
        relationshipToEmployee: input.relationshipToEmployee,
        affirmedReadAndAgree: input.affirmedReadAndAgree,
        acceptsLiability: input.acceptsLiability,
        consentedElectronicSignature: input.consentedElectronicSignature,
        ipAddress,
        userAgent,
        contentHashAtSigning: contentHash,
      }).returning();

      const [updated] = await tx.update(hrGuarantorForms)
        .set({ status: "signed", updatedAt: new Date() })
        .where(eq(hrGuarantorForms.id, form.id))
        .returning();

      return { form: updated, signature };
    });

    return { kind: "signed", form: result.form, signature: result.signature };
  }

  async decline(params: { guarantorFormId: string; reason?: string }): Promise<DeclineOutcome> {
    const form = await this.getById(params.guarantorFormId);
    if (!form || form.status !== "awaiting_guarantor") {
      return { kind: "not_awaiting_guarantor", reason: "This form is not awaiting the guarantor's response." };
    }
    const [updated] = await db.update(hrGuarantorForms)
      .set({ status: "declined", declinedAt: new Date(), declinedReason: params.reason, updatedAt: new Date() })
      .where(eq(hrGuarantorForms.id, form.id))
      .returning();
    return { kind: "declined", form: updated };
  }

  private async validateDocument(doc: { fileMimeType: string; fileSizeBytes: number; storageKey: string }): Promise<string | undefined> {
    if (!ALLOWED_GUARANTOR_DOC_MIME_TYPES.includes(doc.fileMimeType as any)) {
      return `File type ${doc.fileMimeType} is not allowed.`;
    }
    if (doc.fileSizeBytes > MAX_GUARANTOR_DOC_FILE_SIZE_BYTES) {
      return "File is larger than the 10 MB limit.";
    }
    try {
      await objectStorage.headObject(doc.storageKey);
    } catch {
      return "Could not find the uploaded file. Please upload it again.";
    }
    return undefined;
  }

  private hashInitiation(input: InitiateGuarantorFormInput): string {
    return crypto.createHash("sha256").update(JSON.stringify(input, Object.keys(input).sort()), "utf8").digest("hex");
  }

  /** Hashes the employee/NOK data already on the version plus everything the guarantor just submitted - the final, immutable content. */
  private hashFullSubmission(version: HrGuarantorFormVersion, input: FillAndSignGuarantorFormInput): string {
    const combined = {
      employee: {
        title: version.employeeTitle, surname: version.employeeSurname, otherNames: version.employeeOtherNames,
        dob: version.employeeDob, nin: version.employeeNin, address: version.employeeAddress,
      },
      nextOfKin: {
        title: version.nokTitle, surname: version.nokSurname, otherNames: version.nokOtherNames,
      },
      guarantor: input.guarantor,
      eligibilityChecklist: input.eligibilityChecklist,
      printedFullName: input.printedFullName,
      signatureImageStorageKey: input.signatureImage.storageKey,
    };
    return crypto.createHash("sha256").update(JSON.stringify(combined, Object.keys(combined).sort()), "utf8").digest("hex");
  }
}

export const guarantorFormService = new GuarantorFormService();
