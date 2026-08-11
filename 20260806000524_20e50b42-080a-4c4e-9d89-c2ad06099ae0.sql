REVOKE ALL ON FUNCTION public.emit_contact_sync_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_modified_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_owner_key() FROM PUBLIC, anon, authenticated;