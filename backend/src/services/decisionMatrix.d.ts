type EventInput = {
    tenantId: number;
    source: string;
    eventType: string;
    occurredAtISO: string;
    payload: any;
};
export declare function runDecisionMatrix(e: EventInput): Promise<{
    ok: boolean;
    escalated: boolean;
}>;
export {};
//# sourceMappingURL=decisionMatrix.d.ts.map