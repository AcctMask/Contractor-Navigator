export type CommercialTarget = {
  business_name: string;
  city?: string;
  email?: string;
  website?: string;
  telephone?: string;

  target_type: string;
  campaign_priority: string;
  fit_score: number;

  status: string;
  ai_followup_profile: string;
};

