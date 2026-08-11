-- Helper: read the device token presented by the extension
CREATE OR REPLACE FUNCTION public.request_owner_key()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT nullif(current_setting('request.headers', true)::json ->> 'x-owner-key', '')
$$;

CREATE TABLE public.contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_key TEXT NOT NULL,
  full_name TEXT,
  job_title TEXT,
  company TEXT,
  location TEXT,
  email TEXT,
  phone TEXT,
  profile_url TEXT NOT NULL,
  profile_picture TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  contact_date DATE,
  follow_up_date DATE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contacts_owner_profile_unique UNIQUE (owner_key, profile_url)
);

CREATE INDEX contacts_owner_key_idx ON public.contacts (owner_key);
CREATE INDEX contacts_modified_at_idx ON public.contacts (modified_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Device key can read own contacts"
  ON public.contacts FOR SELECT
  USING (public.request_owner_key() IS NOT NULL AND owner_key = public.request_owner_key());

CREATE POLICY "Device key can insert own contacts"
  ON public.contacts FOR INSERT
  WITH CHECK (public.request_owner_key() IS NOT NULL AND owner_key = public.request_owner_key());

CREATE POLICY "Device key can update own contacts"
  ON public.contacts FOR UPDATE
  USING (public.request_owner_key() IS NOT NULL AND owner_key = public.request_owner_key())
  WITH CHECK (owner_key = public.request_owner_key());

CREATE POLICY "Device key can delete own contacts"
  ON public.contacts FOR DELETE
  USING (public.request_owner_key() IS NOT NULL AND owner_key = public.request_owner_key());

-- Change markers only: no contact data, safe to expose to the realtime channel.
CREATE TABLE public.sync_events (
  id BIGSERIAL PRIMARY KEY,
  owner_fingerprint TEXT NOT NULL,
  record_id UUID NOT NULL,
  operation TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sync_events_fingerprint_idx ON public.sync_events (owner_fingerprint, changed_at DESC);

GRANT SELECT ON public.sync_events TO anon;
GRANT SELECT ON public.sync_events TO authenticated;
GRANT ALL ON public.sync_events TO service_role;

ALTER TABLE public.sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Change markers are readable"
  ON public.sync_events FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.touch_modified_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.modified_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER contacts_touch_modified_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_modified_at();

CREATE OR REPLACE FUNCTION public.emit_contact_sync_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.contacts;
BEGIN
  IF TG_OP = 'DELETE' THEN
    rec := OLD;
  ELSE
    rec := NEW;
  END IF;

  INSERT INTO public.sync_events (owner_fingerprint, record_id, operation)
  VALUES (md5(rec.owner_key), rec.id, lower(TG_OP));

  DELETE FROM public.sync_events WHERE changed_at < now() - interval '7 days';

  RETURN NULL;
END;
$$;

CREATE TRIGGER contacts_emit_sync_event
  AFTER INSERT OR UPDATE OR DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.emit_contact_sync_event();

ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_events;