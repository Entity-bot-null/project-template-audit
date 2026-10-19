-- Audit Hub's roles (schema.prisma, enum Role), least to most privileged:
-- placed before admin so the database's order matches ROLES. Adding enum
-- values is an expand step: the running version never reads them.
ALTER TYPE "Role" ADD VALUE 'viewer' BEFORE 'admin';
ALTER TYPE "Role" ADD VALUE 'auditor' BEFORE 'admin';
