import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { newId } from '../src/common/lib/uuidv7';

const DEMO_ORGS = [
  {
    name: 'Nairobi Demo Medical Centre',
    timezone: 'Africa/Nairobi',
    currency: 'KES',
    country: 'KE',
  },
  {
    name: 'Westlands Demo Clinic',
    timezone: 'Africa/Nairobi',
    currency: 'KES',
    country: 'KE',
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

  const prisma = new PrismaClient();

  try {
    for (const demo of DEMO_ORGS) {
      const org = await prisma.organization.upsert({
        where: { id: `demo-${demo.name}` },
        update: {},
        create: { id: newId(), ...demo },
      });
      console.log(`[DEMO ONLY] Organization ready: ${org.name} (${org.id})`);
    }
    console.log('Seed complete. The organizations above are DEMO data only.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});