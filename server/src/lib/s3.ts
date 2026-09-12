import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// AWS S3 document storage — drivers upload verification documents here and the
// admin panel reads them back via short-lived presigned URLs. Credentials come
// from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars, or fall back to the
// standard SDK credential chain (instance role on EC2, ~/.aws/credentials…).

function bucketRequired(): string {
  const bucket = process.env.AWS_S3_BUCKET || "";
  if (!bucket) {
    throw new Error("AWS_S3_BUCKET is not configured on the server");
  }
  return bucket;
}

const s3Region = process.env.AWS_S3_REGION || "af-south-1";

const s3 = new S3Client({
  region: s3Region,
  ...(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

export const DOCUMENT_TYPES = [
  "drivers_license",
  "id_document",
  "prdp",
  "criminal_record",
  "license_disk",
  "carscan_report",
  "vehicle_scan",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === "string" && (DOCUMENT_TYPES as readonly string[]).includes(v);
}

const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MiB per document

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return base || "document";
}

/** Builds the S3 object key for a document.
 *  Layout: documents/{driverUserId}/{type}/{uuid}-{safeName} */
export function documentKey(userId: string, type: DocumentType, fileName: string, id: string): string {
  return `documents/${userId}/${type}/${id}-${sanitizeFileName(fileName)}`;
}

export interface UploadedDocument {
  key: string;
  bucket: string;
  size: number;
}

/** Uploads a base64 data payload to S3. Throws on failure. */
export async function uploadToS3(
  key: string,
  base64Data: string,
  contentType: string
): Promise<UploadedDocument> {
  const bucket = bucketRequired();

  // Accept both raw base64 and full data: URLs from the app.
  const cleaned = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const buffer = Buffer.from(cleaned, "base64");

  if (buffer.length === 0) {
    throw new Error("Document payload is empty");
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document too large (max ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MiB)`);
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return { key, bucket, size: buffer.length };
}

/** Returns a short-lived (15 min) presigned URL for viewing/downloading. */
export async function getPresignedViewUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucketRequired(),
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 15 * 60 });
}

/** Deletes an object from S3 (used when a document row is removed). */
export async function deleteFromS3(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucketRequired(),
      Key: key,
    })
  );
}

export { s3 };