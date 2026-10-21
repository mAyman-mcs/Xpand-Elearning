// Local demo data for trying the student exam flow by hand (never for production):
//   npm run seed-demo -w server
// Creates (or resets) two demo students in "Demo Batch" and four demo exams open to them, and
// prints the students' passwords. Re-running deletes the demo exams' attempts, so they can retake.
import { loadConfig } from "../src/core/config.js";
import { createPrisma } from "../src/core/db.js";
import { tempPassword } from "../src/core/lib/tokens.js";
import { slugify } from "../src/core/lib/slug.js";
import type { QuestionType } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password.js";

const config = loadConfig();
const url = new URL(config.DATABASE_URL);
if (config.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error(`seed-demo: refusing to run against ${url.hostname} (local development databases only).`);
  process.exit(1);
}
const prisma = createPrisma(config.DATABASE_URL);

const HOUR = 3_600_000;
const now = Date.now();

interface Q {
  type: QuestionType;
  text: string;
  options: [string, boolean][];
  points?: number;
}
const tf = (text: string, answer: boolean): Q => ({
  type: "TRUE_FALSE",
  text,
  options: [
    ["True", answer],
    ["False", !answer],
  ],
});

const networking: Q[] = [
  {
    type: "SINGLE_CHOICE",
    text: "Which port does HTTPS use by default?",
    options: [
      ["80", false],
      ["443", true],
      ["22", false],
      ["8080", false],
    ],
  },
  {
    type: "MULTI_CHOICE",
    text: "Which of these are private IPv4 ranges? (choose all that apply)",
    points: 2,
    options: [
      ["10.0.0.0/8", true],
      ["8.8.8.0/24", false],
      ["192.168.0.0/16", true],
      ["172.16.0.0/12", true],
    ],
  },
  tf("TCP is a connectionless protocol.", false),
  {
    type: "SINGLE_CHOICE",
    text: "Which layer of the OSI model does a router work at?",
    options: [
      ["Layer 2 (Data link)", false],
      ["Layer 3 (Network)", true],
      ["Layer 4 (Transport)", false],
      ["Layer 7 (Application)", false],
    ],
  },
  tf("DNS translates domain names into IP addresses.", true),
];

const EXAMS = [
  {
    code: "DEMO-101",
    title: "Networking Fundamentals (demo)",
    note: "the standard exam: fullscreen, shuffled, back navigation, 3 strikes",
    settings: { durationMinutes: 30, requireFullscreen: true, allowBackNavigation: true, strikeLimit: 3 },
    shuffle: true,
    questions: networking,
    window: { opensAt: new Date(now - HOUR), closesAt: new Date(now + 7 * 24 * HOUR) },
  },
  {
    code: "DEMO-STRICT",
    title: "Strict Mode Check (demo)",
    note: "no going back, 2 strikes, fixed order",
    settings: { durationMinutes: 15, requireFullscreen: true, allowBackNavigation: false, strikeLimit: 2 },
    shuffle: false,
    questions: networking.slice(0, 3),
    window: { opensAt: new Date(now - HOUR), closesAt: new Date(now + 7 * 24 * HOUR) },
  },
  {
    code: "DEMO-QUICK",
    title: "Two-Minute Timer (demo)",
    note: "2 minutes, no fullscreen: let the time run out",
    settings: { durationMinutes: 2, requireFullscreen: false, allowBackNavigation: true, strikeLimit: 3 },
    shuffle: false,
    questions: [tf("The timer keeps running even if you close the page.", true), networking[0] as Q],
    window: { opensAt: new Date(now - HOUR), closesAt: new Date(now + 7 * 24 * HOUR) },
  },
  {
    code: "DEMO-LATER",
    title: "Opens Tomorrow (demo)",
    note: "scheduled: shows a countdown, can't be started yet",
    settings: { durationMinutes: 20, requireFullscreen: false, allowBackNavigation: true, strikeLimit: 3 },
    shuffle: false,
    questions: networking.slice(0, 2),
    window: { opensAt: new Date(now + 24 * HOUR), closesAt: new Date(now + 26 * HOUR) },
  },
];

// ─── Reset the previous demo (attempts first: they don't cascade from exams) ───
const old = await prisma.exam.findMany({ where: { code: { in: EXAMS.map((e) => e.code) } }, select: { id: true } });
await prisma.attempt.deleteMany({ where: { examId: { in: old.map((e) => e.id) } } });
await prisma.exam.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });

const category = await prisma.category.upsert({
  where: { slug: "demo" },
  update: { archived: false },
  create: { name: "Demo", slug: slugify("Demo") },
});
const group = await prisma.group.upsert({
  where: { name: "Demo Batch" },
  update: {},
  create: { name: "Demo Batch", intakeStartDate: new Date(new Date().toISOString().slice(0, 10)) },
});

const students = [
  { username: "demo.student1", fullName: "Demo Student One" },
  { username: "demo.student2", fullName: "Demo Student Two" },
];
const credentials: { username: string; password: string }[] = [];
for (const s of students) {
  const password = tempPassword(12);
  const passwordHash = await hashPassword(password, config.BCRYPT_COST);
  const user = await prisma.user.upsert({
    where: { username: s.username },
    update: { passwordHash, isActive: true, mustChangePassword: false, failedLogins: 0, lockedUntil: null },
    create: { ...s, role: "STUDENT", passwordHash, mustChangePassword: false },
  });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.groupMember.upsert({
    where: { userId_groupId: { userId: user.id, groupId: group.id } },
    update: {},
    create: { userId: user.id, groupId: group.id },
  });
  credentials.push({ username: s.username, password });
}

for (const e of EXAMS) {
  const exam = await prisma.exam.create({
    data: {
      code: e.code,
      title: e.title,
      categoryId: category.id,
      status: "PUBLISHED",
      shuffleQuestions: e.shuffle,
      shuffleOptions: e.shuffle,
      ...e.settings,
    },
  });
  for (const [position, q] of e.questions.entries()) {
    await prisma.question.create({
      data: {
        examId: exam.id,
        type: q.type,
        text: q.text,
        points: q.points ?? 1,
        position,
        options: { create: q.options.map(([text, isCorrect], i) => ({ text, isCorrect, position: i })) },
      },
    });
  }
  await prisma.assignment.create({
    data: { examId: exam.id, groupId: group.id, mode: "FIXED", ...e.window },
  });
}

console.log("\nDemo ready. Students (group “Demo Batch”):");
for (const c of credentials) console.log(`  ${c.username.padEnd(15)} ${c.password}`);
console.log("\nExams:");
for (const e of EXAMS) console.log(`  ${e.code.padEnd(12)} ${e.title}: ${e.note}`);
await prisma.$disconnect();
