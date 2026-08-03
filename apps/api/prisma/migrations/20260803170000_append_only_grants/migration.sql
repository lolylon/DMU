-- Append-only evidence tables (architecture §3.2 / NFR 5.5)
-- Applied for miru_app role. Superuser (migrations) retains full rights.

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'miru_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO miru_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO miru_app;

    -- Evidence: no UPDATE/DELETE for application role
    REVOKE UPDATE, DELETE ON TABLE "ConsentAcceptance" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "AccessLog" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "CaseStatusHistory" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "ConclusionVersion" FROM miru_app;
    REVOKE UPDATE, DELETE ON TABLE "TechActionLog" FROM miru_app;

    -- Admin role: metadata only (no PMD content tables)
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'miru_admin') THEN
      GRANT SELECT ON TABLE "Organization", "Department", "Membership", "User", "OrgReadinessItem", "TechActionLog", "CatalogOffer" TO miru_admin;
      GRANT INSERT, UPDATE ON TABLE "Organization", "Department", "Membership", "OrgReadinessItem", "CatalogOffer" TO miru_admin;
      GRANT INSERT ON TABLE "TechActionLog" TO miru_admin;
      -- Explicit deny on clinical content
      REVOKE ALL ON TABLE "Case", "Patient", "Conclusion", "ConclusionVersion", "ChatMessage", "CaseFile", "ConsentAcceptance", "ConsultationSession", "SessionRecording" FROM miru_admin;
    END IF;
  END IF;
END
$$;
