-- Make the newly exposed shared-queue RPC available to the REST API now,
-- rather than waiting for PostgREST's automatic schema cache refresh.
notify pgrst, 'reload schema';
