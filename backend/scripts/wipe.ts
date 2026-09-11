import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const r1 = await prisma.pair.deleteMany({});
  const r2 = await prisma.scan.deleteMany({});
  const r3 = await prisma.memoryPhoto.deleteMany({});
  const r4 = await prisma.playerProgress.deleteMany({});
  const r5 = await prisma.triviaCard.deleteMany({});
  const r6 = await prisma.employee.deleteMany({});

  console.log('Wiped:');
  console.log(`  Pair:           ${r1.count}`);
  console.log(`  Scan:           ${r2.count}`);
  console.log(`  MemoryPhoto:    ${r3.count}`);
  console.log(`  PlayerProgress: ${r4.count}`);
  console.log(`  TriviaCard:     ${r5.count}`);
  console.log(`  Employee:       ${r6.count}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
