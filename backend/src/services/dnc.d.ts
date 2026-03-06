declare function normPhone(p: string): string;
export declare function classifyInboundText(text: string): {
    optOut: boolean;
    foul: boolean;
    reason?: string;
};
export declare function isDnc(tenantId: number, phone: string): Promise<boolean>;
export declare function addDnc(params: {
    tenantId: number;
    phone: string;
    reason?: string;
    source?: string;
}): Promise<void>;
export { normPhone };
//# sourceMappingURL=dnc.d.ts.map