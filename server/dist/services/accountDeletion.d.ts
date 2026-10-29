/**
 * Delete everything that belongs to `userId`, then the user row itself.
 * All-or-nothing: throws (and rolls back) if any real error occurs.
 */
export declare function deleteAccountData(userId: string): Promise<void>;
//# sourceMappingURL=accountDeletion.d.ts.map