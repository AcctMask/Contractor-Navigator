import { FastifyInstance } from "fastify";
/**
 * Twilio will POST form-encoded by default for inbound SMS.
 * Fastify can parse it if you enable content-type parser (we’ll do that in index.ts next).
 */
export declare function twilioRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=twilio.d.ts.map