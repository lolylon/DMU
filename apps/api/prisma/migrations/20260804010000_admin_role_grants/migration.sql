-- Expand miru_admin grants for onboarding/readiness without PMD content tables.
-- Re-apply miru_app table grants after migrations create objects as superuser.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'miru_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO miru_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO miru_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO miru_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO miru_app;

    REVOKE UPDATE, DELETE ON TABLE "ConsentAcceptance" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "AccessLog" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "CaseStatusHistory" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "ConclusionVersion" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "TechActionLog" FROM miru_app;
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'miru_admin') THEN
    GRANT SELECT ON TABLE "Organization", "Department", "Membership", "User", "OrgReadinessItem", "TechActionLog", "CatalogOffer", "ConsentDocument", "ConsultantSchedule" TO miru_admin;
    GRANT INSERT, UPDATE ON TABLE "Organization", "Department", "Membership", "OrgReadinessItem", "CatalogOffer", "User" TO miru_admin;
    GRANT INSERT ON TABLE "TechActionLog" TO miru_admin;
    REVOKE ALL ON TABLE "Case", "Patient", "Conclusion", "ConclusionVersion", "ChatMessage", "CaseFile", "ConsentAcceptance", "ConsultationSession", "SessionRecording" FROM miru_admin;
  END IF;
END
$$;
