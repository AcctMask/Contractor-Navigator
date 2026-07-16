import { pool } from "../db/db"

type JsonObject = Record<string, any>

export type TenantConversationProfile = {
  tenant_id: number
  tenant_slug: string

  identity: {
    business_name: string
    display_name: string
    dba_name: string | null
    team_name: string
    website: string | null
    email: string | null
    phone: string | null
  }

  vocabulary: {
    customer_term: string
    record_term: string
    team_member_term: string
    proposal_term: string
    agreement_term: string
    consultation_term: string
    call_to_action: string
  }

  business: {
    description: string | null
    mission_statement: string | null
    unique_selling_proposition: string | null
    ideal_customer: string | null
    core_values: string | null
    company_story: string | null
    industry: string | null
    territory: string | null
  }

  communication: {
    office_hours: string | null
    after_hours_behavior: string | null
    rejected_call_behavior: string | null
    ring_owner_first: string | null
    scheduling_rules: string | null
    escalation_rules: string | null
  }

  intake: {
    greeting: string
    recognized_customer_question: string
    name_question: string
    location_question: string
    service_question: string
    completion_message: string
    service_examples: string[]
  }

  intent_language: {
    pricing_reply: string
    callback_reply: string
    proposal_request_reply: string
    agreement_request_reply: string
    urgent_request_reply: string
    just_looking_reply: string
  }

  alerts: {
    customer_activity_title: string
    sender_name: string
    proposal_next_action: string
    consultation_next_action: string
    agreement_next_action: string
  }

  raw: {
    identity: JsonObject
    responses: JsonObject
    not_applicable: JsonObject
  }
}

function clean(
  value: unknown,
): string | null {
  const result = String(
    value ?? "",
  ).trim()

  return result || null
}

function first(
  ...values: unknown[]
): string | null {
  for (const value of values) {
    const cleaned = clean(value)

    if (cleaned) {
      return cleaned
    }
  }

  return null
}

function firstNameTemplate(
  message: string,
) {
  return message
}

function primaryTerm(
  value: unknown,
  fallback: string,
) {
  const submitted = clean(value)

  if (!submitted) {
    return fallback
  }

  const firstTerm = submitted
    .split(/[,|;/]+/, 1)[0]
    .trim()

  return firstTerm || fallback
}

function normalizeWholeExamples(
  value: unknown,
): string[] {
  if (Array.isArray(value)) {
    return value
      .map(clean)
      .filter(
        (item): item is string =>
          Boolean(item),
      )
  }

  const submitted = clean(value)

  return submitted
    ? [submitted.replace(/[.]+$/, "")]
    : []
}

function normalizeExamples(
  value: unknown,
): string[] {
  if (Array.isArray(value)) {
    return value
      .map(clean)
      .filter(
        (item): item is string =>
          Boolean(item),
      )
  }

  const text = clean(value)

  if (!text) {
    return []
  }

  return text
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function buildServiceExamples(
  responses: JsonObject,
  industry: string | null,
  consultationTerm: string,
  proposalTerm: string,
): string[] {
  const submitted = [
    ...normalizeExamples(
      responses.service_examples,
    ),

    ...normalizeWholeExamples(
      responses.services_offered,
    ),

    ...normalizeExamples(
      responses.primary_services,
    ),

    ...normalizeExamples(
      responses.customer_needs,
    ),

    ...normalizeExamples(
      responses.common_requests,
    ),

    ...normalizeExamples(
      responses.intake_topics,
    ),
  ]

  if (submitted.length) {
    return Array.from(
      new Set(submitted),
    ).slice(0, 8)
  }

  if (
    String(industry || "")
      .toLowerCase()
      .includes("roof")
  ) {
    return [
      "roof leak",
      proposalTerm.toLowerCase(),
      consultationTerm.toLowerCase(),
      "roof repair",
      "roof replacement",
      "storm damage",
    ]
  }

  return [
    "scheduling",
    consultationTerm.toLowerCase(),
    proposalTerm.toLowerCase(),
    "service questions",
    "pricing questions",
    "next steps",
  ]
}

export async function getTenantConversationProfileBySlug(
  tenantSlug: string,
): Promise<TenantConversationProfile> {
  const result = await pool.query(
    `
      select
        t.id as tenant_id,
        t.slug as tenant_slug,
        t.name as tenant_name,

        coalesce(
          d.identity,
          '{}'::jsonb
        ) as identity,

        coalesce(
          d.responses,
          '{}'::jsonb
        ) as responses,

        coalesce(
          d.not_applicable,
          '{}'::jsonb
        ) as not_applicable,

        coalesce(
          d.branding,
          '{}'::jsonb
        ) as branding,

        coalesce(
          d.workflow_defaults,
          '{}'::jsonb
        ) as workflow_defaults
      from tenants t
      left join tenant_company_dna d
        on d.tenant_id = t.id
      where lower(t.slug) =
        lower($1)
      limit 1
    `,
    [tenantSlug],
  )

  if (!result.rowCount) {
    throw new Error(
      `Tenant not found: ${tenantSlug}`,
    )
  }

  const row = result.rows[0]

  const identity: JsonObject =
    row.identity || {}

  const responses: JsonObject =
    row.responses || {}

  const notApplicable: JsonObject =
    row.not_applicable || {}

  const branding: JsonObject =
    row.branding || {}

  const workflow: JsonObject =
    row.workflow_defaults || {}

  const businessName =
    first(
      responses.company_name,
      responses.legal_business_name,
      identity.company_name,
      row.tenant_name,
    ) ||
    row.tenant_name

  const displayName =
    first(
      responses.business_display_name,
      branding.business_display_name,
      identity.business_display_name,
      responses.dba_name,
      identity.dba_name,
      businessName,
    ) ||
    businessName

  const customerTerm =
    first(
      responses.customer_term,
      workflow.customer_term,
      "Customer",
    ) ||
    "Customer"

  const recordTerm =
    first(
      responses.job_term,
      workflow.job_term,
      "Job",
    ) ||
    "Job"

  const teamMemberTerm =
    first(
      responses.crew_term,
      workflow.crew_term,
      "Team",
    ) ||
    "Team"

  const proposalTerm =
    first(
      responses.estimate_term,
      workflow.estimate_term,
      "Proposal",
    ) ||
    "Proposal"

  const agreementTerm =
    primaryTerm(
      first(
        responses.agreement_term,
        workflow.agreement_term,
      ),
      "Agreement",
    )

  const consultationTerm =
    first(
      responses.inspection_term,
      workflow.inspection_term,
      "Consultation",
    ) ||
    "Consultation"

  const callToAction =
    first(
      responses.call_to_action,
      workflow.call_to_action,
      "Contact Us",
    ) ||
    "Contact Us"

  const industry =
    first(
      responses.industry,
      identity.industry,
    )

  const serviceExamples =
    buildServiceExamples(
      responses,
      industry,
      consultationTerm,
      proposalTerm,
    )

  const senderName =
    first(
      responses.ai_sender_name,
      responses.team_name,
      `${displayName} Team`,
    ) ||
    `${displayName} Team`

  const serviceExamplesText =
    serviceExamples.join(", ")

  return {
    tenant_id:
      Number(row.tenant_id),

    tenant_slug:
      String(row.tenant_slug),

    identity: {
      business_name:
        businessName,

      display_name:
        displayName,

      dba_name:
        first(
          responses.dba_name,
          identity.dba_name,
          branding.dba_name,
        ),

      team_name:
        senderName,

      website:
        first(
          responses.website,
          branding.website,
        ),

      email:
        first(
          responses.primary_email,
          branding.email,
        ),

      phone:
        first(
          responses.primary_phone,
          branding.phone,
        ),
    },

    vocabulary: {
      customer_term:
        customerTerm,

      record_term:
        recordTerm,

      team_member_term:
        teamMemberTerm,

      proposal_term:
        proposalTerm,

      agreement_term:
        agreementTerm,

      consultation_term:
        consultationTerm,

      call_to_action:
        callToAction,
    },

    business: {
      description:
        first(
          responses.business_description,
          identity.business_description,
        ),

      mission_statement:
        first(
          responses.mission_statement,
          identity.mission_statement,
        ),

      unique_selling_proposition:
        first(
          responses.unique_selling_proposition,
          identity
            .unique_selling_proposition,
        ),

      ideal_customer:
        first(
          responses.ideal_customer,
          identity.ideal_customer,
        ),

      core_values:
        first(
          responses.core_values,
          identity.core_values,
        ),

      company_story:
        first(
          responses.company_story,
          identity.company_story,
        ),

      industry,

      territory:
        first(
          responses.territory,
          workflow.territory,
        ),
    },

    communication: {
      office_hours:
        first(
          responses.office_hours,
          workflow.office_hours,
        ),

      after_hours_behavior:
        first(
          responses.after_hours_behavior,
          workflow.after_hours_behavior,
        ),

      rejected_call_behavior:
        first(
          responses.rejected_call_behavior,
          workflow.rejected_call_behavior,
        ),

      ring_owner_first:
        first(
          responses.ring_owner_first,
          workflow.ring_owner_first,
        ),

      scheduling_rules:
        first(
          responses.scheduling_rules,
          workflow.scheduling_rules,
        ),

      escalation_rules:
        first(
          responses.escalation_rules,
          workflow.escalation_rules,
        ),
    },

    intake: {
      greeting:
        first(
          responses.voice_greeting,
          responses.intake_greeting,
          `Thank you for contacting ${displayName}.`,
        ) ||
        `Thank you for contacting ${displayName}.`,

      recognized_customer_question:
        firstNameTemplate(
          `Hi {{name}} — we received your message. What can ${displayName} help you with today?`,
        ),

      name_question:
        first(
          responses.name_question,
          "Got it — what is your full name?",
        ) ||
        "Got it — what is your full name?",

      location_question:
        first(
          responses.location_question,
          responses.address_question,
          "Thanks — what is the service address, business address, or ZIP code?",
        ) ||
        "Thanks — what is the service address, business address, or ZIP code?",

      service_question:
        first(
          responses.service_need_question,
          responses.intake_question,
          `Briefly, what do you need help with? For example: ${serviceExamplesText}.`,
        ) ||
        `Briefly, what do you need help with? For example: ${serviceExamplesText}.`,

      completion_message:
        first(
          responses.intake_completion_message,
          `Thanks — we received your information and someone from ${senderName} will follow up.`,
        ) ||
        `Thanks — we received your information and someone from ${senderName} will follow up.`,

      service_examples:
        serviceExamples,
    },

    intent_language: {
      pricing_reply:
        first(
          responses.pricing_objection_reply,
          `I understand. Which part of the pricing or scope would you like ${displayName} to clarify?`,
        ) ||
        `I understand. Which part of the pricing or scope would you like ${displayName} to clarify?`,

      callback_reply:
        first(
          responses.callback_request_reply,
          `Absolutely. Someone from ${senderName} can call you. What is the main topic you would like them prepared to discuss?`,
        ) ||
        `Absolutely. Someone from ${senderName} can call you. What is the main topic you would like them prepared to discuss?`,

      proposal_request_reply:
        first(
          responses.proposal_request_reply,
          `We can help with your ${proposalTerm.toLowerCase()} request. What details or questions should we address first?`,
        ) ||
        `We can help with your ${proposalTerm.toLowerCase()} request. What details or questions should we address first?`,

      agreement_request_reply:
        first(
          responses.agreement_request_reply,
          `Great. Before we move to the ${agreementTerm.toLowerCase()}, is there anything you would like clarified about pricing, scope, timing, or next steps?`,
        ) ||
        `Great. Before we move to the ${agreementTerm.toLowerCase()}, is there anything you would like clarified about pricing, scope, timing, or next steps?`,

      urgent_request_reply:
        first(
          responses.urgent_request_reply,
          `We received your urgent request. Please briefly describe what is happening so ${senderName} can route it correctly.`,
        ) ||
        `We received your urgent request. Please briefly describe what is happening so ${senderName} can route it correctly.`,

      just_looking_reply:
        first(
          responses.just_looking_reply,
          `That is completely understandable. Are you researching options, planning ahead, or trying to solve a current need?`,
        ) ||
        `That is completely understandable. Are you researching options, planning ahead, or trying to solve a current need?`,
    },

    alerts: {
      customer_activity_title:
        `${customerTerm} replied to AI conversation`,

      sender_name:
        senderName,

      proposal_next_action:
        `Contact the ${customerTerm.toLowerCase()} and address the ${proposalTerm.toLowerCase()} request.`,

      consultation_next_action:
        `Contact the ${customerTerm.toLowerCase()} and confirm ${consultationTerm.toLowerCase()} timing.`,

      agreement_next_action:
        `Send or review the ${agreementTerm.toLowerCase()} and confirm the next step.`,
    },

    raw: {
      identity,
      responses,
      not_applicable:
        notApplicable,
    },
  }
}

export type TenantRuntime = {
  version: 1

  tenant: {
    id: number
    slug: string
  }

  identity:
    TenantConversationProfile["identity"]

  branding: {
    business_display_name: string
    dba_name: string | null
    website: string | null
    email: string | null
    phone: string | null
    primary_color: string | null
    accent_color: string | null
    brand_voice: string | null
  }

  terminology:
    TenantConversationProfile["vocabulary"]

  business:
    TenantConversationProfile["business"]

  workflow: {
    office_hours: string | null
    after_hours_behavior: string | null
    rejected_call_behavior: string | null
    ring_owner_first: string | null
    scheduling_rules: string | null
    escalation_rules: string | null

    lead_qualification: string | null
    estimate_process: string | null
    proposal_process: string | null
    inspection_process: string | null
    close_process: string | null
    invoice_process: string | null
    typical_sales_timeline: string | null
  }

  workspace: JsonObject

  conversation: {
    intake:
      TenantConversationProfile["intake"]

    intent_language:
      TenantConversationProfile["intent_language"]

    alerts:
      TenantConversationProfile["alerts"]

    communication:
      TenantConversationProfile["communication"]

    receptionist: {
      greeting: string
      services: string | null
      service_area: string | null
      scheduling_information_required:
        string | null
      frequently_asked_questions:
        string | null
      promises_allowed: string | null
      promises_not_allowed: string | null
      topics_to_avoid: string | null
      topics_to_promote: string | null
    }
  }

  automation: {
    follow_up_frequency: string | null
    morning_brief: string | null
    weekly_summary: string | null
    urgent_alerts: string | null
    owner_notifications: string | null
    missed_call_notifications: string | null
    buying_signal_notifications: string | null
    customer_reply_notifications: string | null
    seconds_before_ai_answers: number | null
    call_recording: string | null
  }

  permissions: {
    approval_preferences: string | null
    preferred_contact_method: string | null
    vip_contacts: string | null
    internal_contacts: string | null
  }

  integrations: {
    website: string | null
    social_accounts: string | null
    appointment_booking: string | null
    document_storage_preferences:
      string | null
    import_description: string | null
    import_stage_notes: string | null
  }

  source: {
    company_dna_available: boolean
    identity: JsonObject
    responses: JsonObject
    not_applicable: JsonObject
  }
}

function runtimeNumber(
  value: unknown,
): number | null {
  const text = clean(value)

  if (!text) {
    return null
  }

  const numberValue =
    Number(text)

  return Number.isFinite(numberValue)
    ? numberValue
    : null
}

export async function getTenantRuntimeBySlug(
  tenantSlug: string,
): Promise<TenantRuntime> {
  const conversation =
    await getTenantConversationProfileBySlug(
      tenantSlug,
    )

  const result = await pool.query(
    `
      select
        coalesce(
          branding,
          '{}'::jsonb
        ) as branding,

        coalesce(
          workflow_defaults,
          '{}'::jsonb
        ) as workflow_defaults,

        coalesce(
          workspace,
          '{}'::jsonb
        ) as workspace,

        coalesce(
          identity,
          '{}'::jsonb
        ) as identity,

        coalesce(
          responses,
          '{}'::jsonb
        ) as responses,

        coalesce(
          not_applicable,
          '{}'::jsonb
        ) as not_applicable
      from tenant_company_dna
      where tenant_id = $1
      limit 1
    `,
    [
      conversation.tenant_id,
    ],
  )

  const row =
    result.rows[0] || {}

  const branding: JsonObject =
    row.branding || {}

  const workflowDefaults:
    JsonObject =
    row.workflow_defaults || {}

  const workspace: JsonObject =
    row.workspace || {}

  const identity: JsonObject =
    row.identity ||
    conversation.raw.identity ||
    {}

  const responses: JsonObject =
    row.responses ||
    conversation.raw.responses ||
    {}

  const notApplicable:
    JsonObject =
    row.not_applicable ||
    conversation.raw.not_applicable ||
    {}

  const companyDnaAvailable =
    Object.keys(identity).length > 0 ||
    Object.keys(responses).length > 0

  return {
    version: 1,

    tenant: {
      id:
        conversation.tenant_id,

      slug:
        conversation.tenant_slug,
    },

    identity:
      conversation.identity,

    branding: {
      business_display_name:
        conversation.identity
          .display_name,

      dba_name:
        conversation.identity
          .dba_name,

      website:
        conversation.identity
          .website,

      email:
        conversation.identity
          .email,

      phone:
        conversation.identity
          .phone,

      primary_color:
        first(
          responses.primary_color,
          branding.primary_color,
        ),

      accent_color:
        first(
          responses.accent_color,
          branding.accent_color,
        ),

      brand_voice:
        first(
          responses.brand_voice,
          branding.brand_voice,
        ),
    },

    terminology:
      conversation.vocabulary,

    business:
      conversation.business,

    workflow: {
      office_hours:
        conversation.communication
          .office_hours,

      after_hours_behavior:
        conversation.communication
          .after_hours_behavior,

      rejected_call_behavior:
        conversation.communication
          .rejected_call_behavior,

      ring_owner_first:
        conversation.communication
          .ring_owner_first,

      scheduling_rules:
        conversation.communication
          .scheduling_rules,

      escalation_rules:
        conversation.communication
          .escalation_rules,

      lead_qualification:
        first(
          responses.lead_qualification,
          workflowDefaults
            .lead_qualification,
        ),

      estimate_process:
        first(
          responses.estimate_process,
          workflowDefaults
            .estimate_process,
        ),

      proposal_process:
        first(
          responses.proposal_process,
          workflowDefaults
            .proposal_process,
        ),

      inspection_process:
        first(
          responses.inspection_process,
          workflowDefaults
            .inspection_process,
        ),

      close_process:
        first(
          responses.close_process,
          workflowDefaults
            .close_process,
        ),

      invoice_process:
        first(
          responses.invoice_process,
          workflowDefaults
            .invoice_process,
        ),

      typical_sales_timeline:
        first(
          responses
            .typical_sales_timeline,
          workflowDefaults
            .typical_sales_timeline,
        ),
    },

    workspace,

    conversation: {
      intake:
        conversation.intake,

      intent_language:
        conversation.intent_language,

      alerts:
        conversation.alerts,

      communication:
        conversation.communication,

      receptionist: {
        greeting:
          first(
            responses
              .receptionist_greeting,
            responses.voice_greeting,
            conversation.intake
              .greeting,
          ) ||
          conversation.intake
            .greeting,

        services:
          first(
            responses
              .receptionist_services,
          ),

        service_area:
          first(
            responses
              .receptionist_service_area,
            conversation.business
              .territory,
          ),

        scheduling_information_required:
          first(
            responses
              .scheduling_information_required,
          ),

        frequently_asked_questions:
          first(
            responses
              .frequently_asked_questions,
          ),

        promises_allowed:
          first(
            responses.promises_allowed,
          ),

        promises_not_allowed:
          first(
            responses
              .promises_not_allowed,
          ),

        topics_to_avoid:
          first(
            responses.topics_to_avoid,
          ),

        topics_to_promote:
          first(
            responses.topics_to_promote,
          ),
      },
    },

    automation: {
      follow_up_frequency:
        first(
          responses.follow_up_frequency,
        ),

      morning_brief:
        first(
          responses.morning_brief,
        ),

      weekly_summary:
        first(
          responses.weekly_summary,
        ),

      urgent_alerts:
        first(
          responses.urgent_alerts,
        ),

      owner_notifications:
        first(
          responses.owner_notifications,
        ),

      missed_call_notifications:
        first(
          responses
            .missed_call_notifications,
        ),

      buying_signal_notifications:
        first(
          responses
            .buying_signal_notifications,
        ),

      customer_reply_notifications:
        first(
          responses
            .customer_reply_notifications,
        ),

      seconds_before_ai_answers:
        runtimeNumber(
          responses
            .seconds_before_ai_answers,
        ),

      call_recording:
        first(
          responses.call_recording,
        ),
    },

    permissions: {
      approval_preferences:
        first(
          responses
            .approval_preferences,
        ),

      preferred_contact_method:
        first(
          responses
            .preferred_contact_method,
        ),

      vip_contacts:
        first(
          responses.vip_contacts,
        ),

      internal_contacts:
        first(
          responses.internal_contacts,
        ),
    },

    integrations: {
      website:
        first(
          responses.marketing_website,
          responses.website,
          conversation.identity.website,
        ),

      social_accounts:
        first(
          responses.social_accounts,
        ),

      appointment_booking:
        first(
          responses
            .appointment_booking,
        ),

      document_storage_preferences:
        first(
          responses
            .document_storage_preferences,
        ),

      import_description:
        first(
          responses.import_description,
        ),

      import_stage_notes:
        first(
          responses.import_stage_notes,
        ),
    },

    source: {
      company_dna_available:
        companyDnaAvailable,

      identity,

      responses,

      not_applicable:
        notApplicable,
    },
  }
}
