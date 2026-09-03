import { apiRequest } from "@/lib/queryClient";
import { ALLOWED_CONTRACT_MIME_TYPES } from "@shared/schema";

export interface UploadedContractFile {
  storageKey: string;
  fileMimeType: string;
  fileSizeBytes: number;
  fileOriginalName: string;
}

/**
 * Uploads a file/image contract to a business-scoped staging key via
 * POST /api/staff/contract-upload-url, then PUTs it directly to the bucket -
 * this app server never touches the file bytes. Used both when attaching a
 * contract to an already-saved staff member (staff-form.tsx) and inline at
 * staff-creation time, before any staffId exists (staff-form.tsx create
 * mode, onboarding.tsx's staff step) - the upload URL is business-scoped,
 * not staff-scoped, specifically so both can share this one implementation.
 */
export async function uploadContractFileToStaging(file: File): Promise<UploadedContractFile> {
  if (!ALLOWED_CONTRACT_MIME_TYPES.includes(file.type as any)) {
    throw new Error("That file type isn't supported. Use a PDF, PNG, JPEG, or WebP.");
  }

  const urlRes = await apiRequest("POST", "/api/staff/contract-upload-url", {
    fileName: file.name,
    mimeType: file.type,
  });
  const { uploadUrl, storageKey } = await urlRes.json();

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) throw new Error("File upload failed. Please try again.");

  return {
    storageKey,
    fileMimeType: file.type,
    fileSizeBytes: file.size,
    fileOriginalName: file.name,
  };
}
