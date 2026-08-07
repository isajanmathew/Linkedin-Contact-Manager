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
  VALUES (encode(sha256(rec.owner_key::bytea), 'hex'), rec.id, lower(TG_OP));

  DELETE FROM public.sync_events WHERE changed_at < now() - interval '7 days';

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_contact_sync_event() FROM PUBLIC, anon, authenticated;

TRUNCATE public.sync_events;