-- Disposable-only auth compatibility for PashLoc acceptance; never apply to production.
BEGIN;
DO $guard$
BEGIN
 IF current_database() <> 'pashloc_iv_disposable_mfa_isolated'
 OR current_user <> 'pashloc_iv_disposable_mfa_isolated_user' THEN
  RAISE EXCEPTION 'Disposable database identity guard failed';
 END IF;
 IF to_regclass('public.tenants') IS NULL OR to_regclass('public.app_users') IS NULL
 OR to_regclass('public.pashloc_mfa_enrollments') IS NULL THEN
  RAISE EXCEPTION 'Missing disposable authentication prerequisites';
 END IF;
END $guard$;
ALTER TABLE public.app_users
 ADD COLUMN IF NOT EXISTS full_name text,
 ADD COLUMN IF NOT EXISTS mobile_phone text,
 ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'staff',
 ADD COLUMN IF NOT EXISTS financials_authorized boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en',
 ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
 ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $verify$
BEGIN
 IF EXISTS (SELECT 1 FROM public.app_users WHERE full_name IS NULL) THEN
  RAISE EXCEPTION 'Existing users lack full_name; stop instead of inventing identity';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid='public.app_users'::regclass AND contype='u'
  AND pg_get_constraintdef(oid) LIKE '%(tenant_id, email)%') THEN
  RAISE EXCEPTION 'Missing required unique tenant/email constraint';
 END IF;
END $verify$;
ALTER TABLE public.app_users ALTER COLUMN full_name SET NOT NULL;
COMMIT;
