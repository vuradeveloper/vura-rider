import { S3Client } from "@aws-sdk/client-s3";
declare const s3: S3Client;
export declare const DOCUMENT_TYPES: readonly ["drivers_license", "id_document", "prdp", "criminal_record", "license_disk", "carscan_report", "vehicle_scan"];
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export declare function isDocumentType(v: unknown): v is DocumentType;
/** Builds the S3 object key for a document.
 *  Layout: documents/{driverUserId}/{type}/{uuid}-{safeName} */
export declare function documentKey(userId: string, type: DocumentType, fileName: string, id: string): string;
export interface UploadedDocument {
    key: string;
    bucket: string;
    size: number;
}
/** Uploads a base64 data payload to S3. Throws on failure. */
export declare function uploadToS3(key: string, base64Data: string, contentType: string): Promise<UploadedDocument>;
/** Returns a short-lived (15 min) presigned URL for viewing/downloading. */
export declare function getPresignedViewUrl(key: string): Promise<string>;
/** Deletes an object from S3 (used when a document row is removed). */
export declare function deleteFromS3(key: string): Promise<void>;
export { s3 };
//# sourceMappingURL=s3.d.ts.map