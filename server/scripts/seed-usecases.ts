// Local demo of use-case exams (docs/CASE_QUESTIONS_PLAN.md), never for production:
//   npm run seed-usecases -w server
// Loads the two Cyber Week use cases ("Operating System Fundamentals", "Ethical Hacking Assessment")
// as MCQ + essay exams graded by staff, open to "Demo Batch", and prints the demo students'
// passwords. Re-running replaces both exams (and their attempts).
//
// The printed diagrams (boot order, permission tables, open ports) are written as text options here;
// trainers can upload the pictures in the question editor. Following the plan's §7, the lines that
// explained why an option is wrong are staff-only explanations, and hints are hidden from students.
import { loadConfig } from "../src/core/config.js";
import { createPrisma } from "../src/core/db.js";
import { slugify } from "../src/core/lib/slug.js";
import { tempPassword } from "../src/core/lib/tokens.js";
import type { AnswerSize } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/password.js";

const config = loadConfig();
const url = new URL(config.DATABASE_URL);
if (config.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error(`seed-usecases: refusing to run against ${url.hostname} (local development databases only).`);
  process.exit(1);
}
const prisma = createPrisma(config.DATABASE_URL);

const HOUR = 3_600_000;
const now = Date.now();

interface Option {
  text: string;
  detail?: string;
  correct?: boolean;
  explanation?: string;
}
interface FollowUp {
  text: string;
  size: AnswerSize;
  model: string;
}
interface Case {
  label: string;
  title: string;
  situation: string;
  hint: string;
  question: string;
  options: Option[];
  followUps: FollowUp[];
}
interface UseCase {
  code: string;
  title: string;
  intro: string;
  cases: Case[];
}

const INSTRUCTIONS = `Instructions
• This use case continues the TechBridge story: read each situation carefully.
• Each case has one multiple-choice question and written follow-up questions on the same screen.
• Answer the written questions in your own words. Pasting is not allowed.
• Aim to finish all 6 cases within 60 minutes.`;

const OS: UseCase = {
  code: "UC-OS",
  title: "Operating System Fundamentals",
  intro: `The story so far
TechBridge's entire infrastructure stack is built, secured, moved to the cloud, and penetration tested. The final stage before project handover: Ahmed must configure and harden the operating systems on every server and workstation. TechBridge runs Linux on all servers and Windows on employee workstations. Ahmed starts with the fundamentals — making sure the IT team understands what is running under the hood.

${INSTRUCTIONS}`,
  cases: [
    {
      label: "KNOWLEDGE",
      title: "OS type selection",
      situation:
        "Ahmed is deploying TechBridge's web server. He needs an operating system that is stable under 24/7 production load, free to use (no licence cost), supported with regular security patches, and runs efficiently on server hardware without a graphical interface. The CEO says: 'Just pick the right one — I trust your judgement.'",
      hint: "Server operating systems do not need a graphical user interface. Think about the industry standard for web servers worldwide.",
      question: "Which operating system is the most appropriate choice for TechBridge's production web server?",
      options: [
        {
          text: "Windows 10 Home",
          detail: "Consumer desktop OS",
          explanation: "No server features or enterprise support, and it needs a licence.",
        },
        {
          text: "Linux Server (Ubuntu Server / CentOS / RHEL)",
          detail: "Server OS",
          correct: true,
          explanation: "Free, open source, stable, with a vast web-server ecosystem (Apache, Nginx).",
        },
        { text: "Android", detail: "Mobile OS", explanation: "Designed for smartphones, not server workloads." },
        {
          text: "macOS Desktop",
          detail: "Apple desktop OS",
          explanation: "Needs Apple hardware; no rack-server support.",
        },
      ],
      followUps: [
        {
          text: "What is the difference between a desktop OS and a server OS in terms of their primary purpose?",
          size: "LONG",
          model:
            "Desktop: one interactive user, graphical interface, personal apps and devices. Server: provides services to many clients over the network 24/7; built for stability, security, uptime and remote management, usually without a GUI.",
        },
        {
          text: "Name one common web server software that runs on the OS Ahmed selected.",
          size: "SHORT",
          model: "Apache (httpd) or Nginx. Also acceptable: LiteSpeed, Caddy, Tomcat.",
        },
      ],
    },
    {
      label: "FILL IN",
      title: "Linux file permissions",
      situation:
        "Ahmed runs ls -la on TechBridge's web server and sees this line for the application config file:\n\n-rw-r----- 1 root www-data 2048 config.php\n\nThe IT admin asks: 'Who can do what with this file?' Ahmed explains the three permission groups — Owner, Group and Others — using the permission string on the left.",
      hint: "Skip the first '-' (file type), then read three characters for Owner, three for Group, three for Others. r = read, w = write, x = execute, - = no permission.",
      question: "What are the correct permissions for the Owner, Group and Others on this file?",
      options: [
        { text: "Owner: rwx | Group: r-x | Others: r--", explanation: "The string shows rw- for the owner, not rwx." },
        {
          text: "Owner: rw- | Group: r-- | Others: ---",
          correct: true,
          explanation: "Owner reads and writes, the group reads, others have no access (640).",
        },
        {
          text: "Owner: r-- | Group: rw- | Others: r--",
          explanation: "The group having write but not the owner contradicts the string.",
        },
        {
          text: "Owner: rwx | Group: rwx | Others: rwx",
          explanation: "That is 777 (-rwxrwxrwx): full access for everyone.",
        },
      ],
      followUps: [
        {
          text: "What chmod command would Ahmed run to set this file to 640 permissions?",
          size: "SHORT",
          model: "chmod 640 config.php",
        },
        {
          text: "Why does www-data (the web server process) need to be in the Group — and not the Owner?",
          size: "LONG",
          model:
            "The group gives the web server read-only access, which is all it needs. root stays the owner and the only account that can change the file. If www-data owned it, a compromised web server could rewrite the config (least privilege).",
        },
      ],
    },
    {
      label: "DESIGN",
      title: "Boot sequence",
      situation:
        "A junior IT staff member at TechBridge asks Ahmed: 'When I press the power button, what actually happens before the login screen appears?' Ahmed draws four possible sequences on the whiteboard and asks the trainee to identify the correct one. Understanding the boot sequence is essential for troubleshooting systems that fail to start.",
      hint: "The firmware must initialise hardware before any software can run. The bootloader then finds the kernel. The kernel loads the OS environment last.",
      question: "Which sequence correctly represents the order of events when a server boots up?",
      options: [
        {
          text: "Power on → BIOS/UEFI → Bootloader → Kernel loading → OS login",
          correct: true,
          explanation: "The firmware initialises hardware first, then hands off to the bootloader.",
        },
        {
          text: "Power on → Bootloader → BIOS/UEFI → Kernel loading → OS login",
          explanation: "The bootloader can't run before the firmware.",
        },
        {
          text: "Power on → BIOS/UEFI → Kernel loading → Bootloader → OS login",
          explanation: "The kernel can't run before the bootloader loads it.",
        },
        {
          text: "Power on → Bootloader → Kernel loading → BIOS/UEFI → OS login",
          explanation: "BIOS/UEFI always runs before any software can load.",
        },
      ],
      followUps: [
        {
          text: "What is the role of BIOS/UEFI in the boot process?",
          size: "LONG",
          model:
            "Firmware that runs first: initialises and tests the hardware (POST), then finds the boot device and starts the bootloader.",
        },
        {
          text: "What is Secure Boot and why does it improve server security?",
          size: "LONG",
          model:
            "A UEFI feature that only runs bootloaders and kernels signed with trusted keys. It stops bootkits/rootkits from loading before the OS and its defences start.",
        },
      ],
    },
    {
      label: "KNOWLEDGE",
      title: "Process lifecycle",
      situation:
        "TechBridge's web server is under load. Ahmed runs the top command and notices that one of the application processes (a database query handler) shows the state 'S' (Sleeping/Waiting). The IT admin asks: 'Is this process broken? Should I kill it?' Ahmed explains what state the process is in and why it is normal behaviour.",
      hint: "A process waiting for an external event (like a database response or I/O) is not wasting CPU — it yields until the event arrives.",
      question: "What state is the database query handler process in, and why is this normal?",
      options: [
        {
          text: "Running — the process is actively using the CPU right now",
          explanation: "A running process uses CPU every cycle; it would not be idle in top.",
        },
        {
          text: "Ready — the process is waiting for the CPU scheduler to assign it CPU time",
          explanation: "A ready process has everything but the CPU; 'S' is not that state.",
        },
        {
          text: "Waiting / Blocked — the process is waiting for the database I/O to complete",
          correct: true,
          explanation: "Normal: it releases the CPU while waiting and uses no CPU.",
        },
        {
          text: "Terminated — the process has finished and can be safely removed",
          explanation: "A terminated process disappears from the process list.",
        },
      ],
      followUps: [
        {
          text: "What is the difference between a process and a thread?",
          size: "LONG",
          model:
            "A process is a running program with its own memory space and resources. A thread is a unit of execution inside a process; threads of one process share its memory, so they are lighter but less isolated.",
        },
        {
          text: "What Linux command does Ahmed use to view all running processes and their states?",
          size: "SHORT",
          model: "top (or htop), or ps aux / ps -ef (STAT column).",
        },
      ],
    },
    {
      label: "KNOWLEDGE",
      title: "Kernel mode vs user mode",
      situation:
        "Ahmed is explaining OS architecture to TechBridge's junior IT staff: 'The OS separates operations into two privilege levels — kernel mode and user mode. Which one handles direct hardware access?' He then gives the team four scenarios and asks them to identify which one requires kernel mode.",
      hint: "User-mode applications cannot access hardware directly. They must ask the OS via a system call. Kernel mode is where the OS itself operates.",
      question: "Which operation requires kernel mode (Ring 0) to execute?",
      options: [
        {
          text: "Opening a text file in a text editor",
          explanation: "A user-mode application; the OS does the hardware access for it.",
        },
        {
          text: "Loading a web page in a browser",
          explanation: "Socket calls go through the OS, but the browser runs in user mode.",
        },
        {
          text: "Writing data directly to a disk sector via a system call",
          correct: true,
          explanation: "Direct hardware I/O is protected: only the kernel can perform it.",
        },
        { text: "Running a Python script", explanation: "The Python interpreter runs in user mode." },
      ],
      followUps: [
        {
          text: "What is a system call? Give one example from Linux (e.g. read, write, fork).",
          size: "LONG",
          model:
            "The controlled way a user program asks the kernel to do privileged work: the CPU switches to kernel mode, the kernel does it and returns. Examples: read, write, open, fork, execve.",
        },
        {
          text: "Why is it dangerous to allow user applications to run in kernel mode?",
          size: "LONG",
          model:
            "Kernel mode has unrestricted access to all memory and hardware. A bug could crash the whole system and malware could take full control, bypassing every protection and isolation between programs.",
        },
      ],
    },
    {
      label: "DESIGN",
      title: "Linux security setup",
      situation:
        "Ahmed sets up four user accounts on TechBridge's Linux server: root (system admin), admin (IT staff with admin duties), developer (application developer), and guest (a temporary contractor). He must configure sudo access and file permissions so that each account has only what it needs — following the Principle of Least Privilege.",
      hint: "Each user should access only what their role requires. The guest account needs the least access. Only administrators should have sudo.",
      question: "Which user permission setup correctly implements Least Privilege for all four accounts?",
      options: [
        {
          text: "All four accounts: sudo, system files, app files and their home directory",
          explanation: "No privilege separation: any account breach is a full system compromise.",
        },
        {
          text: "root: everything · admin: sudo, system files, home · developer: app files, home · guest: home only",
          correct: true,
          explanation: "Each account has only what it needs: a breach stays contained.",
        },
        {
          text: "root: everything · admin, developer and guest: home directory only (no sudo)",
          explanation: "Without sudo, admin tasks are impossible and the system becomes unmanageable.",
        },
        {
          text: "root: everything · admin: sudo, system files, home · developer: app files, home · guest: system files, app files, home",
          explanation: "The guest can write to system and app files: a critical risk.",
        },
      ],
      followUps: [
        {
          text: "What is wrong with the first option (all accounts have everything), even if all accounts use strong passwords?",
          size: "LONG",
          model:
            "No privilege separation: one compromised, misused or mistaken account (even the guest) means full control of the system. Strong passwords don't limit the damage once an account is in.",
        },
        {
          text: "What Linux command does Ahmed run to add the admin user to the sudo group?",
          size: "SHORT",
          model: "sudo usermod -aG sudo admin (on RHEL/CentOS: the wheel group). Also: gpasswd -a admin sudo.",
        },
      ],
    },
  ],
};

const EH: UseCase = {
  code: "UC-EH",
  title: "Ethical Hacking Assessment",
  intro: `The story so far
TechBridge's network is built, secured with a firewall and VPN, and their infrastructure is running on AWS with a properly segmented VPC. Before the CEO signs off, MCS Distributors proposes a penetration test: 'Let us attack your environment ethically — before a real attacker does.' The CEO agrees and signs a formal scope document. Ahmed is assigned as the lead tester.

${INSTRUCTIONS}`,
  cases: [
    {
      label: "KNOWLEDGE",
      title: "Penetration testing methodology",
      situation:
        "Before Ahmed runs a single tool, his team lead reminds him: 'A professional pen test always follows a defined methodology. If you jump straight into exploitation without proper reconnaissance and scanning, you will miss critical vulnerabilities and potentially cause unintended outages.' Ahmed must order his approach correctly before touching TechBridge's systems.",
      hint: "You cannot exploit what you have not scanned. You cannot scan what you have not discovered. The final deliverable is always a report.",
      question: "Which sequence correctly represents the phases of a professional penetration test?",
      options: [
        {
          text: "Reconnaissance → Scanning & enumeration → Exploitation → Post-exploitation → Reporting",
          correct: true,
          explanation: "Reconnaissance first, reporting last.",
        },
        {
          text: "Exploitation → Reconnaissance → Scanning & enumeration → Post-exploitation → Reporting",
          explanation: "Exploitation before scanning is impossible without known targets.",
        },
        {
          text: "Scanning & enumeration → Reconnaissance → Exploitation → Reporting → Post-exploitation",
          explanation: "Scanning before reconnaissance: targets are still unknown.",
        },
        {
          text: "Reconnaissance → Exploitation → Scanning & enumeration → Post-exploitation → Reporting",
          explanation: "Exploitation before scanning skips enumeration entirely.",
        },
      ],
      followUps: [
        {
          text: "What is the difference between active reconnaissance and passive reconnaissance?",
          size: "LONG",
          model:
            "Passive: gathering information without touching the target (OSINT, DNS records, WHOIS, search engines); undetectable. Active: interacting with the target directly (ping sweeps, port scans, banner grabbing); can be detected and logged.",
        },
        {
          text: "What legal document must be signed BEFORE a penetration test begins?",
          size: "SHORT",
          model:
            "A written authorisation: the scope / rules of engagement (statement of work), signed by the system owner.",
        },
      ],
    },
    {
      label: "TROUBLESHOOT",
      title: "Network scanning & enumeration",
      situation:
        "Ahmed runs an Nmap scan against TechBridge's public-facing web server. The scan returns:\n\n22/tcp   open  ssh    OpenSSH 7.4\n80/tcp   open  http   Apache 2.2.34\n443/tcp  open  https  Apache 2.2.34\n3306/tcp open  mysql  MySQL 5.6.40\n\nAhmed immediately flags two critical findings in his notes before any exploitation.",
      hint: "Look for services that should never be internet-facing, and software versions that are end-of-life or have published CVEs.",
      question: "Which two findings from this scan output represent the most critical security risks?",
      options: [
        {
          text: "Port 22 (SSH) is open and port 443 (HTTPS) is open",
          explanation: "Standard remote access and secure web: both expected.",
        },
        {
          text: "Apache 2.2.34 is end-of-life (many CVEs) and MySQL 3306 is exposed to the internet",
          correct: true,
          explanation: "An outdated web server plus a database reachable from outside.",
        },
        {
          text: "Port 80 (HTTP) redirecting to 443 (HTTPS) is a misconfiguration",
          explanation: "An HTTP-to-HTTPS redirect is standard and expected.",
        },
        {
          text: "SSH version 7.4 is outdated, and MySQL is on a non-standard port",
          explanation: "OpenSSH 7.4 is patched; 3306 is MySQL's standard port.",
        },
      ],
      followUps: [
        {
          text: "What immediate remediation should Ahmed recommend for the MySQL finding?",
          size: "LONG",
          model:
            "Close 3306 to the internet (firewall / security group); bind MySQL to localhost or the private network; allow only the application server; then upgrade MySQL and use least-privilege DB accounts.",
        },
        {
          text: "What Nmap flag would Ahmed use to also detect the service version numbers?",
          size: "SHORT",
          model: "-sV (or -A, which includes it).",
        },
      ],
    },
    {
      label: "DESIGN",
      title: "Attack surface assessment",
      situation:
        "Ahmed is reviewing four server configurations across TechBridge's AWS environment. Each server exposes a different set of ports and services to the internet. Ahmed must identify which server has the smallest attack surface — and which has the largest. He will include both in his report with recommended remediations.",
      hint: "Every open port is a potential entry point. Legacy protocols like Telnet and FTP send credentials in plaintext and should never be exposed to the internet.",
      question: "Which server configuration presents the smallest attack surface to an external attacker?",
      options: [
        {
          text: "Open ports: HTTPS 443, SSH 22",
          correct: true,
          explanation: "Only two ports: the smallest attack surface.",
        },
        {
          text: "Open ports: HTTPS 443, SSH 22, FTP 21, Telnet 23, RDP 3389",
          explanation: "Legacy protocols: Telnet sends credentials in plaintext.",
        },
        {
          text: "Open ports: HTTPS 443, SSH 22, MySQL 3306, RDP 3389",
          explanation: "Database port open to the internet: direct database attacks.",
        },
        {
          text: "Open ports: HTTPS 443, FTP 21, Telnet 23, RDP 3389, SMB 445, MySQL 3306",
          explanation: "Maximum exposure: several critical services.",
        },
      ],
      followUps: [
        {
          text: "Why is Telnet (port 23) classified as a CRITICAL risk?",
          size: "LONG",
          model:
            "Telnet sends everything, including usernames and passwords, in plaintext: anyone on the path can sniff the credentials. It has no encryption or strong authentication; SSH replaces it.",
        },
        {
          text: "Which option has the largest attack surface, and what is the most dangerous port it exposes?",
          size: "LONG",
          model:
            "The last option (six open ports). Most dangerous: SMB 445 (EternalBlue, wormable ransomware such as WannaCry); Telnet 23 is also acceptable with a reason.",
        },
      ],
    },
    {
      label: "TROUBLESHOOT",
      title: "OWASP Top 10 — vulnerability identification",
      situation:
        "Ahmed tests TechBridge's internal web portal — the system employees use to log in and access HR files. He finds a search field that accepts employee names. When he types the following into the search box:\n\n' OR '1'='1\n\nthe application returns ALL employee records from the database — including salary data, home addresses, and passwords stored in plaintext.",
      hint: "The input was interpreted as database code — the application did not separate data from commands.",
      question: "Which OWASP Top 10 vulnerability did Ahmed just discover?",
      options: [
        { text: "Broken Authentication", explanation: "About weak or badly managed sessions and passwords." },
        {
          text: "SQL Injection (A03:2021 — Injection)",
          correct: true,
          explanation: "User input became part of the SQL query.",
        },
        { text: "Cross-Site Scripting (XSS)", explanation: "Scripts injected into pages other users view." },
        {
          text: "Insecure Direct Object Reference (IDOR)",
          explanation: "Accessing others' resources by changing an identifier.",
        },
      ],
      followUps: [
        {
          text: "What is the primary developer-side fix to prevent this vulnerability?",
          size: "LONG",
          model: "Parameterised queries / prepared statements (or a safe ORM), so input is always data and never SQL.",
        },
        {
          text: "What is a secondary defence Ahmed should recommend if SQL injection input is still attempted?",
          size: "LONG",
          model:
            "Any of: input validation (allow-lists), a web application firewall, a least-privilege database account, error messages that reveal nothing, and hashing the stored passwords.",
        },
      ],
    },
    {
      label: "KNOWLEDGE",
      title: "Web proxy & traffic interception",
      situation:
        "Ahmed wants to analyse the HTTP requests and responses between his browser and TechBridge's web portal in real time. He needs to see exactly which parameters are sent in login requests, whether session tokens are in cookies, and whether the application leaks sensitive information in HTTP headers. He sets up a tool that sits between his browser and the server.",
      hint: "This type of tool is a web proxy (intercepting proxy): it lets the tester read and modify every request and response.",
      question: "Which tool should Ahmed use to intercept and inspect web application traffic?",
      options: [
        {
          text: "Wireshark",
          detail: "Packet analyser",
          explanation: "Captures all traffic at the interface level; not a browser proxy.",
        },
        {
          text: "Burp Suite",
          detail: "Web security testing toolkit",
          correct: true,
          explanation: "An intercepting proxy: captures, modifies and replays HTTP/HTTPS requests.",
        },
        {
          text: "Nmap",
          detail: "Network scanner",
          explanation: "Finds open ports and services; doesn't inspect HTTP content.",
        },
        {
          text: "Metasploit",
          detail: "Exploitation framework",
          explanation: "Launches exploits; not a traffic inspector.",
        },
      ],
      followUps: [
        {
          text: "What does Ahmed need to install in his browser to route HTTPS traffic through this tool?",
          size: "LONG",
          model:
            "The tool's CA certificate, trusted by the browser (so it can decrypt HTTPS), and the browser's proxy set to the tool (e.g. 127.0.0.1:8080, or via FoxyProxy).",
        },
        {
          text: "Name one thing Ahmed should check for in the HTTP response headers that may reveal server information.",
          size: "SHORT",
          model:
            "The Server header (e.g. Apache/2.2.34) or X-Powered-By (framework and version). Also: missing security headers.",
        },
      ],
    },
    {
      label: "TROUBLESHOOT",
      title: "Exploitation & reporting",
      situation:
        "Ahmed has found that TechBridge's old file server runs an unpatched version of SMB (EternalBlue vulnerability — MS17-010). With written permission from the CEO, he attempts exploitation using Metasploit. After gaining a shell, he documents exactly what data he could access, what he could modify, and what the business impact would be if a real attacker had done this.",
      hint: "A professional report has distinct sections: where you found a vulnerability, its business impact, how you exploited it, and what to do about it.",
      question: "Which section of the penetration test report should contain Ahmed's findings from this exploitation?",
      options: [
        { text: "Executive summary", explanation: "A high-level overview for leadership, without technical detail." },
        {
          text: "Technical findings — vulnerability details",
          correct: true,
          explanation: "CVE references, exploitation steps, evidence, risk rating and remediation per finding.",
        },
        { text: "Scope & rules of engagement", explanation: "Defines what is in scope and what is permitted." },
        { text: "Methodology", explanation: "Describes the testing framework, not specific findings." },
      ],
      followUps: [
        {
          text: "What CVE number is associated with the EternalBlue vulnerability Ahmed exploited?",
          size: "SHORT",
          model: "CVE-2017-0144 (MS17-010; the bulletin also covers CVE-2017-0143 to 0148).",
        },
        {
          text: "What risk rating (Critical / High / Medium / Low) would Ahmed assign to this finding, and why?",
          size: "LONG",
          model:
            "Critical: unauthenticated remote code execution with SYSTEM privileges, a public exploit, wormable (WannaCry, NotPetya), and access to the file server's data.",
        },
      ],
    },
  ],
};

const USE_CASES = [OS, EH];

// ─── Reset the previous run (attempts first: they don't cascade from exams) ───
const old = await prisma.exam.findMany({ where: { code: { in: USE_CASES.map((u) => u.code) } }, select: { id: true } });
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

for (const u of USE_CASES) {
  const exam = await prisma.exam.create({
    data: {
      code: u.code,
      title: u.title,
      intro: u.intro,
      categoryId: category.id,
      status: "PUBLISHED",
      type: "MCQ_ESSAY",
      scoringMode: "MANUAL_APPROVAL",
      durationMinutes: 60,
      // The story runs in order; options inside cases keep their letters anyway.
      shuffleQuestions: false,
      shuffleOptions: true,
      allowBackNavigation: true,
      requireFullscreen: true,
      strikeLimit: 3,
      showHints: false,
    },
  });
  let position = 0;
  for (const c of u.cases) {
    const row = await prisma.questionCase.create({
      data: { examId: exam.id, label: c.label, title: c.title, situation: c.situation, hint: c.hint },
    });
    await prisma.question.create({
      data: {
        examId: exam.id,
        caseId: row.id,
        type: "SINGLE_CHOICE",
        text: c.question,
        points: 2,
        position: position++,
        options: {
          create: c.options.map((o, i) => ({
            text: o.text,
            detail: o.detail ?? null,
            isCorrect: o.correct ?? false,
            explanation: o.explanation ?? null,
            position: i,
          })),
        },
      },
    });
    for (const f of c.followUps)
      await prisma.question.create({
        data: {
          examId: exam.id,
          caseId: row.id,
          type: "ESSAY",
          text: f.text,
          answerSize: f.size,
          guidance: f.model,
          points: 1,
          position: position++,
        },
      });
  }
  await prisma.assignment.create({
    data: {
      examId: exam.id,
      groupId: group.id,
      mode: "FIXED",
      opensAt: new Date(now - HOUR),
      closesAt: new Date(now + 7 * 24 * HOUR),
    },
  });
}

console.log("\nUse cases ready. Students (group “Demo Batch”):");
for (const c of credentials) console.log(`  ${c.username.padEnd(15)} ${c.password}`);
console.log("\nExams (6 cases each, 24 points, graded by staff):");
for (const u of USE_CASES) console.log(`  ${u.code.padEnd(8)} ${u.title}`);
console.log("\nGrade submitted attempts as a super admin: exam → Grading.");
await prisma.$disconnect();
