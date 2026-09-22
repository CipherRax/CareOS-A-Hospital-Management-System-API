import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { newId } from '../src/common/lib/uuidv7';
import { DEFAULT_ROLE_LIST } from '../src/common/auth/role-matrix';
import {
  assertPasswordPolicy,
  hashPassword,
} from '../src/common/security/password';

/**
 * DEMO-ONLY seed for local development / e2e iteration. Deterministic ids keep
 * it idempotent (safe to re-run). Never point at real data — production
 * refuses to seed unless SEED_ALLOWED=true is set explicitly.
 */

const DEMO_PASSWORD = 'DemoPass123!';

const DEMO_ORGS = [
  {
    id: 'demo-org-nairobi',
    name: 'Nairobi Demo Medical Centre',
    legalName: 'Nairobi Demo Medical Centre Ltd',
    tradingName: 'Nairobi Demo Medical Centre',
    registrationNumber: 'DEMO-REG-NAI-001',
    kraPin: 'P000DEMO1K',
    phone: '+254700000001',
    email: 'admin@nairobi-demo.careos.test',
    county: 'Nairobi',
    town: 'Nairobi',
    address: 'Demo Road, Upper Hill, Nairobi',
    timezone: 'Africa/Nairobi',
    currency: 'KES',
    country: 'KE',
  },
  {
    id: 'demo-org-westlands',
    name: 'Westlands Demo Clinic',
    legalName: 'Westlands Demo Clinic Ltd',
    tradingName: 'Westlands Demo Clinic',
    registrationNumber: 'DEMO-REG-WL-001',
    kraPin: 'P000DEMO2K',
    phone: '+254700000002',
    email: 'admin@westlands-demo.careos.test',
    county: 'Nairobi',
    town: 'Nairobi',
    address: 'Demo Avenue, Westlands, Nairobi',
    timezone: 'Africa/Nairobi',
    currency: 'KES',
    country: 'KE',
  },
];

const NAIROBI_BRANCHES = [
  { code: 'NB-HQ', name: 'Nairobi Head Office' },
  { code: 'NB-TH', name: 'Thika Satellite Branch' },
];

const WESTLANDS_BRANCHES = [
  { code: 'WL-MN', name: 'Westlands Main Clinic' },
];

const NAIROBI_DEPARTMENTS = [
  { code: 'CAS', name: 'Casualty & Emergency', kind: 'CUSTOM' },
  { code: 'OUT', name: 'Outpatient Clinic', kind: 'STANDARD' },
  { code: 'LAB', name: 'Laboratory', kind: 'STANDARD' },
  { code: 'RAD', name: 'Radiology', kind: 'STANDARD' },
  { code: 'PHM', name: 'Pharmacy', kind: 'STANDARD' },
  { code: 'FIN', name: 'Finance', kind: 'STANDARD' },
  { code: 'ADM', name: 'Administration', kind: 'STANDARD' },
];

type DemoUser = {
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  staff: { staffNumber: string; professionalTitle?: string } | null;
};

const NAIROBI_USERS: DemoUser[] = [
  {
    email: 'admin@nairobi-demo.careos.test',
    firstName: 'Aisha',
    lastName: 'Nyambura',
    role: 'SUPER_ADMIN',
    staff: { staffNumber: 'STAFF-NAI-001', professionalTitle: 'Practice Administrator' },
  },
  {
    email: 'dr.ahmed@nairobi-demo.careos.test',
    firstName: 'Ahmed',
    lastName: 'Hassan',
    role: 'DOCTOR',
    staff: { staffNumber: 'STAFF-NAI-002', professionalTitle: 'Consultant Physician' },
  },
  {
    email: 'nurse.waithera@nairobi-demo.careos.test',
    firstName: 'Wanjiru',
    lastName: 'Waithera',
    role: 'NURSE',
    staff: { staffNumber: 'STAFF-NAI-003', professionalTitle: 'Registered Nurse' },
  },
  {
    email: 'lab.otieno@nairobi-demo.careos.test',
    firstName: 'Otieno',
    lastName: 'Adhiambo',
    role: 'LAB_TECHNICIAN',
    staff: { staffNumber: 'STAFF-NAI-004', professionalTitle: 'Lab Technician' },
  },
  {
    email: 'reception.mwangi@nairobi-demo.careos.test',
    firstName: 'Mwangi',
    lastName: 'Kamau',
    role: 'RECEPTIONIST',
    staff: { staffNumber: 'STAFF-NAI-005', professionalTitle: 'Receptionist' },
  },
  {
    email: 'finance.cherono@nairobi-demo.careos.test',
    firstName: 'Cherono',
    lastName: 'Kiprop',
    role: 'ACCOUNTANT',
    staff: { staffNumber: 'STAFF-NAI-006', professionalTitle: 'Accountant' },
  },
  {
    email: 'auditor.kamau@nairobi-demo.careos.test',
    firstName: 'Kamau',
    lastName: 'Njoroge',
    role: 'AUDITOR',
    staff: null,
  },
];

const WESTLANDS_USERS: DemoUser[] = [
  {
    email: 'admin@westlands-demo.careos.test',
    firstName: 'Brian',
    lastName: 'Ochieng',
    role: 'OWNER',
    staff: { staffNumber: 'STAFF-WL-001', professionalTitle: 'Owner / Director' },
  },
  {
    email: 'dr.anjela@westlands-demo.careos.test',
    firstName: 'Anjela',
    lastName: 'Mwende',
    role: 'DOCTOR',
    staff: { staffNumber: 'STAFF-WL-002', professionalTitle: 'Physician' },
  },
];

async function main(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && process.env.SEED_ALLOWED !== 'true') {
    console.error(
      'REFUSING to seed in production. Set SEED_ALLOWED=true only in a disposable environment.',
    );
    process.exit(1);
  }

  assertPasswordPolicy(DEMO_PASSWORD);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const prisma = new PrismaClient();

  try {
    for (const orgTemplate of DEMO_ORGS) {
      const { id: orgId, ...orgData } = orgTemplate;
      const org = await prisma.organization.upsert({
        where: { id: orgId },
        update: { ...orgData },
        create: { id: orgId, ...orgData },
      });

      // Role matrix (all 15 roles, org-scoped, deterministic keys).
      const roleIds = new Map<string, string>();
      for (const def of DEFAULT_ROLE_LIST) {
        const role = await prisma.role.upsert({
          where: { organizationId_key: { organizationId: orgId, key: def.key } },
          update: { name: def.name, description: def.description, permissions: def.permissions },
          create: {
            id: newId(),
            organizationId: orgId,
            key: def.key,
            name: def.name,
            description: def.description,
            permissions: [...def.permissions],
            isSystem: ['SUPER_ADMIN', 'OWNER', 'HOSPITAL_ADMIN'].includes(def.key),
          },
        });
        roleIds.set(def.key, role.id);
      }

      // Branches.
      const branchTemplates =
        orgId === 'demo-org-nairobi' ? NAIROBI_BRANCHES : WESTLANDS_BRANCHES;
      const branchIds = new Map<string, string>();
      for (const b of branchTemplates) {
        const branch = await prisma.branch.upsert({
          where: {
            organizationId_code: { organizationId: orgId, code: b.code },
          },
          update: { name: b.name, status: 'ACTIVE' },
          create: {
            id: newId(),
            organizationId: orgId,
            name: b.name,
            code: b.code,
          },
        });
        branchIds.set(b.code, branch.id);
      }

      // Departments (Nairobi demo only).
      const departmentIds = new Map<string, string>();
      if (orgId === 'demo-org-nairobi') {
        for (const d of NAIROBI_DEPARTMENTS) {
          const department = await prisma.department.upsert({
            where: { organizationId_name: { organizationId: orgId, name: d.name } },
            update: { kind: d.kind as never, active: true },
            create: {
              id: newId(),
              organizationId: orgId,
              name: d.name,
              code: d.code,
              kind: d.kind as never,
            },
          });
          departmentIds.set(d.code, department.id);
        }
      }

      // Users + staff + roles + branch/department links.
      const users = orgId === 'demo-org-nairobi' ? NAIROBI_USERS : WESTLANDS_USERS;
      for (const u of users) {
        const user = await prisma.user.upsert({
          where: { organizationId_email: { organizationId: orgId, email: u.email } },
          update: {
            firstName: u.firstName,
            lastName: u.lastName,
            status: 'ACTIVE',
            passwordHash,
          },
          create: {
            id: newId(),
            organizationId: orgId,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            status: 'ACTIVE',
            passwordHash,
          },
        });

        if (u.staff) {
          await prisma.staffProfile.upsert({
            where: { organizationId_staffNumber: { organizationId: orgId, staffNumber: u.staff.staffNumber } },
            update: { professionalTitle: u.staff.professionalTitle ?? null },
            create: {
              id: newId(),
              organizationId: orgId,
              userId: user.id,
              staffNumber: u.staff.staffNumber,
              professionalTitle: u.staff.professionalTitle ?? null,
            },
          });
        }

        await prisma.userRole.deleteMany({ where: { userId: user.id } });
        await prisma.userRole.createMany({
          data: [{ id: newId(), organizationId: orgId, userId: user.id, roleId: roleIds.get(u.role)! }],
        });

        // Every demo user is linked to all of their org's branches/departments.
        await prisma.userBranch.deleteMany({ where: { userId: user.id } });
        await prisma.userBranch.createMany({
          data: [...branchIds.values()].map((branchId) => ({
            id: newId(),
            organizationId: orgId,
            userId: user.id,
            branchId,
          })),
        });
        await prisma.userDepartment.deleteMany({ where: { userId: user.id } });
        await prisma.userDepartment.createMany({
          data: [...departmentIds.values()].map((departmentId) => ({
            id: newId(),
            organizationId: orgId,
            userId: user.id,
            departmentId,
          })),
        });
      }

      console.log(
        `[DEMO ONLY] ${org.name}: ${DEFAULT_ROLE_LIST.length} roles, ` +
          `${branchIds.size} branch(es), ${departmentIds.size} department(s), ${users.length} user(s). ` +
          `(${orgId})`,
      );
    }
    console.log(
      `Seed complete. DEMO ONLY. Sign in with any demo user and password: ${DEMO_PASSWORD}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});