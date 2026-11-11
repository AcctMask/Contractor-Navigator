import type { FastifyInstance } from "fastify";
import { pool } from "../db/db";
import { getCurrentUserFromToken } from "../services/authService";

// Subsequent tarp = independent job with its own financial and operational history.
export async function registerAdditionalTarpRoutes(app: FastifyInstance) {
  app.post("/admin/job/:tenant_slug/:job_id/additional-tarp", async (request: any, reply) => {
    const slug = String(request.params?.tenant_slug || "");
    const sourceId = Number(request.params?.job_id);
    if (slug !== "g2g-roofing") return reply.code(403).send({ok:false,error:"Not enabled for tenant"});
    if (!Number.isSafeInteger(sourceId) || sourceId <= 0) return reply.code(400).send({ok:false,error:"Invalid job"});
    const auth = String(request.headers.authorization || "");
    const user = auth.startsWith("Bearer ") ? await getCurrentUserFromToken(auth.slice(7)) : null;
    if (!user?.is_active) return reply.code(401).send({ok:false,error:"Authentication required"});
    if (!["platform_owner","tenant_admin","admin","manager"].includes(String(user.role)))
      return reply.code(403).send({ok:false,error:"Management role required"});

    const tenant = await pool.query("select id from tenants where slug=$1", [slug]);
    if (!tenant.rowCount) return reply.code(404).send({ok:false,error:"Tenant not found"});
    const tenantId = Number(tenant.rows[0].id);
    if (user.role !== "platform_owner" && Number(user.tenant_id) !== tenantId)
      return reply.code(403).send({ok:false,error:"Tenant access denied"});

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sourceResult = await client.query(
        "select j.*, c.full_name as linked_name, c.phone as linked_phone, c.email as linked_email " +
        "from jobs j left join customers c on c.tenant_id=j.tenant_id and c.id=j.customer_id " +
        "where j.tenant_id=$1 and j.id=$2 limit 1", [tenantId,sourceId]);
      if (!sourceResult.rowCount) {
        await client.query("ROLLBACK");
        return reply.code(404).send({ok:false,error:"Original job not found"});
      }
      const source = sourceResult.rows[0];
      if (!source.customer_id || !String(source.address1 || "").trim()) {
        await client.query("ROLLBACK");
        return reply.code(409).send({ok:false,error:"Original job requires customer and property address"});
      }
      const match = source.external_crm === "navigator_repeat_tarp"
        ? String(source.external_job_id || "").match(/^([0-9]+)_[0-9]+$/) : null;
      const rootId = match ? Number(match[1]) : sourceId;
      await client.query("select pg_advisory_xact_lock($1::integer,$2::integer)",[tenantId,rootId]);
      const numbers = await client.query(
        "select coalesce(max(split_part(external_job_id,'_',2)::integer),1)+1 as n from jobs " +
        "where tenant_id=$1 and external_crm='navigator_repeat_tarp' " +
        "and external_job_id ~ ('^' || $2::text || '_[0-9]+$')",
        [tenantId,rootId]);
      const reference = String(rootId) + "_" + String(numbers.rows[0].n);

      // Contact and claim context only. Never duplicate old billing, work, photos or timeline.
      const created = await client.query(
        "insert into jobs (tenant_id,customer_id,external_crm,external_job_id," +
        "external_customer_id,external_customer_name,customer_phone,customer_email," +
        "address1,city,state,zip,secondary_contact_name,secondary_contact_phone," +
        "secondary_contact_email,secondary_contact_type,carrier,claim_number,date_of_loss," +
        "policy_holder,adjuster_name,adjuster_phone,adjuster_email," +
        "job_type,stage,bot_paused,bot_pause_reason,lead_source,lead_source_detail,created_at,updated_at)" +
        " values ($1,$2,'navigator_repeat_tarp',$3,$4,$5,$6,$7,$8,$9,$10,$11," +
        "$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22," +
        "'Tarp','tarp',true,'Additional tarp pending office review'," +
        "'repeat_tarp','additional_tarp_from_existing_job',now(),now())" +
        " returning id,external_job_id,stage,bot_paused",
        [tenantId,source.customer_id,reference,source.external_customer_id,
         source.external_customer_name || source.linked_name,
         source.linked_phone || source.customer_phone,
         source.linked_email || source.customer_email,
         source.address1,source.city,source.state,source.zip,
         source.secondary_contact_name,source.secondary_contact_phone,
         source.secondary_contact_email,source.secondary_contact_type,
         source.carrier,source.claim_number,source.date_of_loss,source.policy_holder,
         source.adjuster_name,source.adjuster_phone,source.adjuster_email]);
      const job = created.rows[0];
      const meta = JSON.stringify({source_job_id:sourceId,root_job_id:rootId,
        related_job_id:Number(job.id),repeat_reference:reference,
        financial_data_copied:false,bot_initially_paused:true,actor_user_id:Number(user.id)});
      await client.query(
        "insert into timeline_events(tenant_id,job_id,kind,message,meta,created_at) " +
        "values($1,$2,'additional_tarp_job_created',$3,$4::jsonb,now())",
        [tenantId,job.id,"Additional tarp "+reference+" created from Job #"+sourceId,meta]);
      await client.query(
        "insert into timeline_events(tenant_id,job_id,kind,message,meta,created_at) " +
        "values($1,$2,'additional_tarp_job_linked',$3,$4::jsonb,now())",
        [tenantId,sourceId,"Additional tarp "+reference+" opened as Job #"+job.id,meta]);
      await client.query("COMMIT");
      return reply.code(201).send({ok:true,source_job_id:sourceId,
        job_id:Number(job.id),repeat_reference:reference,stage:job.stage,
        bot_paused:Boolean(job.bot_paused)});
    } catch(error:any) {
      try { await client.query("ROLLBACK"); } catch {}
      request.log.error(error,"Additional tarp creation failed");
      return reply.code(500).send({ok:false,error:"Additional tarp job could not be created"});
    } finally {
      client.release();
    }
  });
}
