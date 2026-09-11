// import { PrismaClient, Prisma } from '@prisma/client';
// import { format } from 'sql-formatter';

// const isProd = process.env.NODE_ENV === 'production';

// export const prisma = new PrismaClient({
//   log: isProd
//     ? [
//         { emit: 'stdout', level: 'warn' },
//         { emit: 'stdout', level: 'error' },
//       ]
//     : [
//         { emit: 'event', level: 'query' },
//         { emit: 'stdout', level: 'warn' },
//         { emit: 'stdout', level: 'error' },
//       ],
// });

// if (!isProd) {
//   prisma.$on('query' as never, (e: Prisma.QueryEvent) => {
//     let query = e.query;

//     try {
//       const params: unknown[] = JSON.parse(e.params);
//       params.forEach((p, i) => {
//         const value =
//           p === null
//             ? 'NULL'
//             : typeof p === 'string'
//               ? `'${p}'`
//               : typeof p === 'object'
//                 ? `'${JSON.stringify(p)}'`
//                 : String(p);
//         // replace $1, $2, ... โดยใช้ word boundary กัน $1 ไปชน $10
//         query = query.replace(new RegExp(`\\$${i + 1}\\b`), value);
//       });
//     } catch {
//       // ถ้า parse params ไม่ได้ ก็ใช้ query เดิม
//     }

//     const pretty = format(query, { language: 'postgresql' });
//     const color = e.duration > 100 ? '\x1b[31m' : e.duration > 50 ? '\x1b[33m' : '\x1b[36m';
//     const reset = '\x1b[0m';

//     console.log(`\n${color}⏱  ${e.duration}ms${reset}`);
//     console.log(pretty);
//     console.log('─'.repeat(60));
//   });
// }

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['warn', 'error'],
});