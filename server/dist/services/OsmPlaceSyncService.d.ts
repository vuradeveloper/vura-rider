export declare function syncOsmPlaces(): Promise<{
    added: number;
    total: number;
}>;
export declare function startOsmPlaceSync(): NodeJS.Timeout;
export declare function stopOsmPlaceSync(): void;
export declare function getOsmSyncStatus(): {
    lastSyncAt: string | undefined;
    lastError: string | null;
    lastAdded: number;
    nextSyncInMs: number | null;
};
//# sourceMappingURL=OsmPlaceSyncService.d.ts.map