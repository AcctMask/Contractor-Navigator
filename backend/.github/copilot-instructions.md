# Copilot Instructions — Contractor Autopilot Backend

This repository is a Fastify + TypeScript backend for Contractor Autopilot.

Architecture goals:
- deterministic automation engine
- auditable event timeline
- CRM-agnostic integrations
- scheduler-driven automation
- multi-tenant support

Core stack:
- Node.js
- Fastify
- PostgreSQL (Supabase)
- Zod validation
- pg Pool for database

Project structure:

src/
  routes/
    admin.ts
    events.ts
    webhooks.ts
  services/
    decisionMatrix.ts
    scheduler.ts
    leapDispatch.ts
    escalationEmail.ts
  db/
    db.ts
  index.ts

Important patterns:

Timeline Logging

All major actions must be logged to the timeline system.

Example:

await timeline.add(
  tenant_slug,
  "event_received",
  "jobprogress:stage_changed",
  { payload }
)

Never perform important actions without timeline logging.

Automation Pattern

Events enter through:

POST /events

Events trigger logic inside decisionMatrix.ts.

Decision matrix may:
- create jobs
- start automations
- schedule future actions
- notify escalation systems

Scheduler Pattern

scheduler.ts runs timed actions.

Scheduled actions include:
- follow ups
- EMS grace timers
- escalation notifications
- CRM dispatch actions

Scheduler must:
1. claim actions safely
2. run actions
3. mark completed
4. write timeline logs

Dispatch Pattern

External CRM integrations must go through dispatch services.

Example:

services/leapDispatch.ts

Dispatch services should:
- send outbound webhook
- include tenant_slug
- include job_id
- include claim data when available
- be CRM-agnostic

Webhook Pattern

Inbound integrations must use:

routes/webhooks.ts

Webhook handlers must:
- verify signatures
- validate payloads with Zod
- update timeline
- update job state
- notify operations when necessary

Email Escalation

Operational notifications use:

services/escalationEmail.ts

Example:

Work Auth signed → notify info@g2groofing.com

Email notifications should be used sparingly.

Automation should handle most logic autonomously.

Code Style Rules

Prefer:
- explicit TypeScript types
- small service modules
- async/await
- Zod validation
- timeline logging for major actions

Avoid:
- hidden side effects
- long functions
- unlogged automation steps
- business logic inside route files
