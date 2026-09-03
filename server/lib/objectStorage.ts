import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Small, provider-agnostic wrapper around whatever S3-compatible bucket this
// deployment points at (real AWS S3, Cloudflare R2, DigitalOcean Spaces,
// MinIO, ...). Swapping provider is an env-var change, never a code change -
// see .env.example for the S3_* variables this reads.
//
// Used only for the file/image contract-upload path (server/services/
// StaffContractService.ts); typed contracts stay as plain text in the DB.

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || "auto";
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined; // unset for real AWS
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === "true";

let _client: S3Client | undefined;

function getClient(): S3Client {
  if (!_client) {
    if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
      throw new Error("S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY must be set to use object storage.");
    }
    _client = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      forcePathStyle: S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

function bucket(): string {
  if (!S3_BUCKET) throw new Error("S3_BUCKET must be set to use object storage.");
  return S3_BUCKET;
}

export interface ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  etag?: string;
}

export const objectStorage = {
  /**
   * A presigned URL the browser can PUT directly to, so a contract upload
   * never has to proxy through this server (no multer/disk buffering). The
   * declared contentType is baked into the signature, so the browser cannot
   * upload as a different type than what was requested.
   */
  async getSignedPutUrl(key: string, contentType: string, expirySeconds = 300): Promise<string> {
    const command = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType });
    return getSignedUrl(getClient(), command, { expiresIn: expirySeconds });
  },

  /** A presigned URL for viewing/downloading a stored contract. */
  async getSignedGetUrl(key: string, expirySeconds = 300): Promise<string> {
    const command = new GetObjectCommand({ Bucket: bucket(), Key: key });
    return getSignedUrl(getClient(), command, { expiresIn: expirySeconds });
  },

  /**
   * Re-reads the object's actual size/type from the bucket rather than
   * trusting whatever the client claimed on attach - a browser can lie about
   * Content-Type on the PUT. Used by StaffContractService.attachContract
   * before it ever commits a contract row.
   */
  async headObject(key: string): Promise<ObjectMetadata> {
    const result = await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { contentType: result.ContentType, contentLength: result.ContentLength, etag: result.ETag };
  },

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await getClient().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buffer, ContentType: contentType }));
  },

  /**
   * Not exercised by this feature today - contract versions are immutable
   * and never deleted, only superseded. Present for completeness / future use.
   */
  async deleteObject(key: string): Promise<void> {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },
};
