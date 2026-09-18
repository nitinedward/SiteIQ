-- Firms: the email domain reports are written against
--
-- The engineer's address on a report was built against a hardcoded domain,
-- which is fine for one firm and wrong for every other one. It's now a firm
-- setting, editable on the Settings page.
--
-- Existing firms are backfilled with the domain that was hardcoded, so their
-- reports keep reading the same. A firm that leaves it empty gets no address
-- rather than someone else's.
--
-- Run this once in the Supabase SQL editor.

alter table public.firms
  add column if not exists report_email_domain text;

update public.firms
   set report_email_domain = 'silvesterclark.co.nz'
 where report_email_domain is null;
