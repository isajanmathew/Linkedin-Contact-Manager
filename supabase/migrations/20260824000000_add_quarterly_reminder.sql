ALTER TABLE public.contacts
ADD COLUMN IF NOT EXISTS quarterly_reminder BOOLEAN NOT NULL DEFAULT true;
