-- Fix search_knowledge function search_path so pgvector <=> operator
-- resolves correctly at runtime in Supabase hosted environment
ALTER FUNCTION search_knowledge(UUID, extensions.vector, INTEGER)
  SET search_path = public, extensions;
