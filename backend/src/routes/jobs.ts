import { FastifyInstance } from "fastify";

export default async function (app: FastifyInstance) {

  // 🔍 SEARCH OR LOAD JOBS
  app.get("/jobs/search", async (req: any, reply) => {
    const qRaw = (req.query.q || "").toString().trim();

    try {
      // 👉 DEFAULT: load recent jobs if no query
      if (!qRaw) {
        const { data, error } = await app.supabase
          .from("jobs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(25);

        if (error) throw error;

        return data;
      }

      const q = qRaw.toLowerCase();

      // 👉 FLEXIBLE SEARCH
      const { data, error } = await app.supabase
        .from("jobs")
        .select("*")
        .or(`
          customer_name.ilike.%${q}%,
          phone.ilike.%${q}%,
          address.ilike.%${q}%,
          city.ilike.%${q}%,
          zip.ilike.%${q}%
        `)
        .order("created_at", { ascending: false })
        .limit(25);

      if (error) throw error;

      return data;
    } catch (err) {
      console.error("Search error:", err);
      reply.code(500).send({ error: "Search failed" });
    }
  });

  // 📦 GET JOB BY ID
  app.get("/jobs/:id", async (req: any, reply) => {
    const id = Number(req.params.id);

    if (!id) {
      return reply.code(400).send({ error: "Invalid job ID" });
    }

    const { data, error } = await app.supabase
      .from("jobs")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return reply.code(404).send({ error: "Job not found" });
    }

    return data;
  });

  // 🛠 UPDATE JOB (STAGE FIX INCLUDED)
  app.post("/jobs/:id", async (req: any, reply) => {
    const id = Number(req.params.id);

    if (!id) {
      return reply.code(400).send({ error: "Invalid job ID" });
    }

    const { stage, crm_substatus, bot_paused, dnc } = req.body;

    try {
      const { error } = await app.supabase
        .from("jobs")
        .update({
          stage,
          crm_substatus,
          bot_paused,
          dnc,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;

      return { ok: true };
    } catch (err) {
      console.error("Stage update failed:", err);
      reply.code(500).send({ error: "Update failed" });
    }
  });
}
