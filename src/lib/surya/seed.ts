// SuryaDesk deterministic demo seed.
// Creates two organizations (main demo + isolation-test org), demo users,
// and a substantial realistic fictional dataset. Idempotent.
import { db } from "@/lib/db";
import type { Customer, Installation, AmcContract, MaintenancePlan, ServiceRequest } from "@prisma/client";
import bcrypt from "bcryptjs";

// ── deterministic PRNG ──────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240613);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const daysFromNow = (d: number, hour = 10) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  x.setHours(hour, randInt(0, 50), 0, 0);
  return x;
};
const iso = (d: Date) => d.toISOString();

export const DEMO_PASSWORD = "Demo@1234";

// ── name pools (fictional) ──────────────────────────────────────
const FIRST_NAMES = [
  "Anita", "Vikram", "Rajesh", "Meena", "Suresh", "Lakshmi", "Mahesh", "Geeta", "Ramesh", "Savitri",
  "Dinesh", "Kamla", "Harish", "Nirmala", "Bhupendra", "Shanti", "Naveen", "Rekha", "Alok", "Pushpa",
  "Vinod", "Usha", "Shyam", "Radha", "Girish", "Saroj", "Manish", "Divya", "Prakash", "Nisha",
  "Arun", "Seema", "Rohit", "Asha", "Sanjay", "Poonam", "Ajay", "Ritu", "Vimal", "Kiran",
  "Mukesh", "Jyoti", "Nitin", "Anjali", "Rakesh", "Smruti", "Devendra", "Bhavna", "Yash", "Trupti",
  "Kunal", "Aparna", "Mohit", "Leela",
];
const LAST_NAMES = [
  "Deshmukh", "Rathore", "Sharma", "Iyer", "Patel", "Reddy", "Joshi", "Nair", "Gupta", "Kulkarni",
  "Mehta", "Bhatt", "Chauhan", "Rao", "Verma", "Pillai", "Singh", "Desai", "Kapoor", "Menon",
  "Saxena", "Ghosh", "Pandey", "Shetty", "Dutta",
];
const CITIES = ["Jaipur", "Jodhpur", "Ajmer", "Udaipur", "Kota", "Delhi", "Ahmedabad"];
const CITY_TAGS: Record<string, string> = {
  Jaipur: "JAIP", Jodhpur: "JDHP", Ajmer: "AJMR", Udaipur: "UDRP", Kota: "KOTA", Delhi: "DELI", Ahmedabad: "AHMD",
};
const LOCALITIES = ["Malviya Nagar", "Vaishali Nagar", "Civil Lines", "Shastri Nagar", "Sector 4", "Sector 11", "Pal Link Road", "Ambamata", "Bapu Nagar", "Sitapura", "C-Scheme", "Ratanada"];

const PANEL_BRANDS = [
  { make: "Waaree", model: "WSM-335" },
  { make: "Adani Solar", model: "ASM-330" },
  { make: "Vikram Solar", model: "SOM-335" },
  { make: "Renewsys", model: "RESYS-330" },
  { make: "Goldi Solar", model: "GSM-340" },
];
const INVERTER_BRANDS = [
  { make: "Sungrow", model: "SG5K-D" },
  { make: "Growatt", model: "MIN-5000TL" },
  { make: "Delta", model: "RPI-5K" },
  { make: "Sofar", model: "HYD-6K" },
  { make: "Fronus", model: "FR-5000" },
];

const INCLUDED_SERVICES = ["Preventive maintenance visits", "Panel cleaning", "Inverter health check", "Wiring inspection", "Performance report after each visit"];
const EXCLUDED_SERVICES = ["Physical part replacement", "Panel replacement beyond warranty", "Structural modification", "Cable replacement beyond 5 m"];

// synthetic demo photo (SVG, explicitly labeled)
function syntheticPhoto(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
  <rect width="480" height="360" fill="hsl(${hue},30%,92%)"/>
  <rect x="40" y="80" width="400" height="240" rx="16" fill="hsl(${hue},25%,85%)"/>
  <g transform="translate(70,110)">
    ${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${c * 88}" y="${r * 66}" width="76" height="54" rx="8" fill="hsl(${hue},18%,72%)" stroke="hsl(${hue},22%,55%)" stroke-width="2"/><rect x="${c * 88 + 8}" y="${r * 66 + 8}" width="60" height="38" rx="4" fill="hsl(${hue},20%,62%)"/>`).join("")).join("")}
  </g>
  <rect x="0" y="330" width="480" height="30" fill="hsl(${hue},30%,40%)"/>
  <text x="240" y="350" font-family="Arial" font-size="14" fill="#fff" text-anchor="middle">Synthetic demo photo — ${label}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

const COMPLAINT_CHECKLIST = [
  { label: "Verified complaint details with customer", kind: "BOOLEAN", required: true },
  { label: "Visual inspection of panels completed", kind: "BOOLEAN", required: true },
  { label: "Inverter status and error logs checked", kind: "BOOLEAN", required: true },
  { label: "Electrical connections and wiring inspected", kind: "BOOLEAN", required: true },
  { label: "Issue resolved and verified", kind: "BOOLEAN", required: true },
  { label: "Work area cleaned after service", kind: "BOOLEAN", required: false },
  { label: "Observations", kind: "TEXT", required: false },
];
const MAINTENANCE_CHECKLIST = [
  { label: "Panels cleaned and physically inspected", kind: "BOOLEAN", required: true },
  { label: "Inverter functioning verified", kind: "BOOLEAN", required: true },
  { label: "Mounting structure bolts tightened", kind: "BOOLEAN", required: true },
  { label: "Wiring and connectors inspected", kind: "BOOLEAN", required: true },
  { label: "Earthing and safety checked", kind: "BOOLEAN", required: true },
  { label: "Customer briefed on system status", kind: "BOOLEAN", required: false },
  { label: "Observations", kind: "TEXT", required: false },
];

const REQUEST_DESCRIPTIONS: Record<string, string[]> = {
  MAINTENANCE: [
    "Solar panels appear dusty, requesting the periodic maintenance visit as per our AMC.",
    "Please schedule the half-yearly service visit for our rooftop system.",
    "We have not had a service visit in a while — requesting maintenance as per contract.",
  ],
  INVERTER: [
    "The inverter shows a red fault light since yesterday evening. Display shows an error code.",
    "Inverter keeps beeping and switching off during afternoon hours. Please send a technician.",
    "Our inverter display is blank since morning. System seems to have shut down.",
  ],
  CLEANING: [
    "There is a lot of dust and bird droppings on the panels. Requesting a cleaning visit.",
    "After the dust storm last week, panels are very dirty. Please arrange cleaning.",
    "Trees nearby have shed leaves over the panels. Requesting professional cleaning.",
  ],
  MONITORING: [
    "We are unable to access the monitoring app. It shows the system as offline.",
    "The monitoring dashboard has not updated for three days. Please check.",
    "App login for our solar system is not working. Need assistance.",
  ],
  INSPECTION: [
    "Requesting a general inspection before the monsoon season.",
    "We are planning to sell the house and need an inspection certificate for the solar system.",
    "Please inspect the mounting structure; there was construction work on the roof last month.",
  ],
  OTHER: [
    "Need a copy of our last service report for insurance purposes.",
    "Requesting an update of our contact details and AMC documents.",
  ],
};

// ── main seed ───────────────────────────────────────────────────
export async function seedDemoData() {
  const passHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // ---------- organizations ----------
  const mainOrg = await db.organization.upsert({
    where: { slug: "sunroot-solar" },
    update: {},
    create: {
      name: "SunRoot Solar Energy",
      slug: "sunroot-solar",
      city: "Jaipur",
      phone: "+91 90000 70001",
      email: "hello@sunroot.example.in",
      supportEmail: "support@sunroot.example.in",
      address: "Plot 21, Sitapura Industrial Area, Jaipur, Rajasthan",
      plan: "ENTERPRISE",
      isDemo: true,
    },
  });
  const secondOrg = await db.organization.upsert({
    where: { slug: "pulsegrid-renewables" },
    update: {},
    create: {
      name: "PulseGrid Renewables",
      slug: "pulsegrid-renewables",
      city: "Ahmedabad",
      phone: "+91 90000 80001",
      email: "team@pulsegrid.example.in",
      address: "402, Sun Avenue One, Manekbaug, Ahmedabad",
      plan: "GROWTH",
      isDemo: true,
    },
  });

  // ---------- demo users ----------
  interface StaffSpec { email: string; name: string; role: string; title: string; phone: string }
  const mainStaff: StaffSpec[] = [
    { email: "owner@demo.suryadesk.in", name: "Priya Sharma", role: "OWNER", title: "Founder & Director", phone: "+91 90000 70011" },
    { email: "manager@demo.suryadesk.in", name: "Arjun Mehta", role: "MANAGER", title: "Service Operations Manager", phone: "+91 90000 70012" },
    { email: "manager2@demo.suryadesk.in", name: "Kavita Joshi", role: "MANAGER", title: "Customer Success Manager", phone: "+91 90000 70013" },
    { email: "tech1@demo.suryadesk.in", name: "Ravi Kumar", role: "TECHNICIAN", title: "Senior Field Technician", phone: "+91 90000 70014" },
    { email: "tech2@demo.suryadesk.in", name: "Sunita Verma", role: "TECHNICIAN", title: "Field Technician", phone: "+91 90000 70015" },
    { email: "tech3@demo.suryadesk.in", name: "Deepak Yadav", role: "TECHNICIAN", title: "Field Technician", phone: "+91 90000 70016" },
    { email: "tech4@demo.suryadesk.in", name: "Meera Choudhary", role: "TECHNICIAN", title: "Junior Technician", phone: "+91 90000 70017" },
  ];
  const secondStaff: StaffSpec[] = [
    { email: "owner2@demo.suryadesk.in", name: "Sanjay Patel", role: "OWNER", title: "Managing Partner", phone: "+91 90000 80011" },
    { email: "tech5@demo.suryadesk.in", name: "Imran Sheikh", role: "TECHNICIAN", title: "Field Technician", phone: "+91 90000 80012" },
  ];

  const staffUsers: Record<string, string> = {}; // email -> userId
  for (const s of [...mainStaff, ...secondStaff]) {
    const user = await db.user.upsert({
      where: { email: s.email },
      update: { name: s.name, baseRole: s.role, emailVerified: true },
      create: { email: s.email, passwordHash: passHash, name: s.name, baseRole: s.role, phone: s.phone, emailVerified: true },
    });
    staffUsers[s.email] = user.id;
  }
  for (const s of mainStaff) {
    await db.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: mainOrg.id, userId: staffUsers[s.email] } },
      update: { role: s.role, title: s.title },
      create: {
        organizationId: mainOrg.id,
        userId: staffUsers[s.email],
        role: s.role,
        title: s.title,
        skills: JSON.stringify(s.role === "TECHNICIAN" ? ["Inverter diagnostics", "Panel cleaning", "Structure work"] : []),
      },
    });
  }
  for (const s of secondStaff) {
    await db.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: secondOrg.id, userId: staffUsers[s.email] } },
      update: { role: s.role, title: s.title },
      create: { organizationId: secondOrg.id, userId: staffUsers[s.email], role: s.role, title: s.title, skills: "[]" },
    });
  }

  const owner = staffUsers["owner@demo.suryadesk.in"];
  const manager = staffUsers["manager@demo.suryadesk.in"];
  const techIds = [staffUsers["tech1@demo.suryadesk.in"], staffUsers["tech2@demo.suryadesk.in"], staffUsers["tech3@demo.suryadesk.in"], staffUsers["tech4@demo.suryadesk.in"]];

  // ---------- checklist templates ----------
  const tpl = (name: string, kind: string, items: { label: string; kind: string; required: boolean }[]) => ({
    organizationId: mainOrg.id,
    name,
    kind,
    items: JSON.stringify(items),
  });
  const existingTpls = await db.checklistTemplate.count({ where: { organizationId: mainOrg.id } });
  if (existingTpls === 0) {
    await db.checklistTemplate.createMany({
      data: [tpl("Complaint service checklist", "COMPLAINT", COMPLAINT_CHECKLIST), tpl("Preventive maintenance checklist", "MAINTENANCE", MAINTENANCE_CHECKLIST)],
    });
  }

  // ---------- helper: create customers + installations + equipment + warranties ----------
  const usedNames = new Set<string>();
  function uniqueName(): { first: string; last: string; name: string } {
    for (let i = 0; i < 500; i++) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const name = `${first} ${last}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return { first, last, name };
      }
    }
    throw new Error("name pool exhausted");
  }

  const mainCustomerCount = await db.customer.count({ where: { organizationId: mainOrg.id } });
  if (mainCustomerCount === 0) {
    // 54 fictional customers; first two are portal demo accounts
    const custSpecs: { name: string; email: string; city: string; phone: string; portal: string }[] = [];
    // Customer 1 & 2 — linked to demo portal logins
    custSpecs.push({ name: "Anita Deshmukh", email: "customer@demo.suryadesk.in", city: "Jaipur", phone: "+91 90000 90001", portal: "ACTIVE" });
    custSpecs.push({ name: "Vikram Rathore", email: "customer2@demo.suryadesk.in", city: "Udaipur", phone: "+91 90000 90002", portal: "ACTIVE" });
    for (let i = 0; i < 52; i++) {
      const { name } = uniqueName();
      const city = pick(CITIES);
      custSpecs.push({
        name,
        email: name.toLowerCase().replace(/\s+/g, ".") + "@mail.example.in",
        city,
        phone: `+91 90000 ${String(90003 + i).padStart(5, "0")}`,
        portal: rand() < 0.25 ? (rand() < 0.5 ? "INVITED" : "ACTIVE") : "NONE",
      });
    }

    const customers: Customer[] = [];
    for (const c of custSpecs) {
      customers.push(
        await db.customer.create({
          data: {
            organizationId: mainOrg.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            city: c.city,
            address: `${randInt(1, 240)}, ${pick(LOCALITIES)}, ${c.city}`,
            portalStatus: c.portal,
            notes: rand() < 0.2 ? "Prefers morning service visits." : null,
          },
        })
      );
    }

    // link portal demo logins
    for (const [email, customerEmail] of [
      ["customer@demo.suryadesk.in", "customer@demo.suryadesk.in"],
      ["customer2@demo.suryadesk.in", "customer2@demo.suryadesk.in"],
    ] as const) {
      const u = await db.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash: passHash, name: email === "customer@demo.suryadesk.in" ? "Anita Deshmukh" : "Vikram Rathore", baseRole: "CUSTOMER", emailVerified: true },
      });
      const cust = await db.customer.findFirst({ where: { organizationId: mainOrg.id, email: customerEmail } });
      if (cust) await db.customer.update({ where: { id: cust.id }, data: { userId: u.id, portalStatus: "ACTIVE" } });
    }

    // ---------- installations (84) ----------
    const capacities = [2, 3, 3, 4, 4, 5, 5, 6, 8, 10];
    const installations: Installation[] = [];
    let assetSeq = 1;
    const citySeq: Record<string, number> = { Jaipur: 0, Jodhpur: 0, Ajmer: 0, Udaipur: 0, Kota: 0, Delhi: 0, Ahmedabad: 0 };
    for (let i = 0; i < 84; i++) {
      const cust = customers[i % customers.length];
      const panel = pick(PANEL_BRANDS);
      const inverter = pick(INVERTER_BRANDS);
      const kw = capacities[i % capacities.length];
      const installDate = daysFromNow(-randInt(200, 1500));
      const city = cust.city;
      citySeq[city] += 1;
      const inst = await db.installation.create({
        data: {
          organizationId: mainOrg.id,
          customerId: cust.id,
          assetCode: `ASSET-${CITY_TAGS[city]}-${String(citySeq[city]).padStart(4, "0")}`,
          siteAddress: cust.address ?? `${pick(LOCALITIES)}, ${city}`,
          city,
          capacityKw: kw,
          installDate,
          panelMake: panel.make,
          panelModel: panel.model,
          panelCount: Math.ceil((kw * 1000) / 335),
          inverterMake: inverter.make,
          inverterModel: inverter.model,
          serialNumber: `SN-${CITY_TAGS[city]}-${100000 + assetSeq * 37}`,
          status: "ACTIVE",
        },
      });
      assetSeq++;
      installations.push(inst);

      // equipment
      await db.equipment.createMany({
        data: [
          { organizationId: mainOrg.id, installationId: inst.id, kind: "PANEL", brand: panel.make, model: panel.model, quantity: Math.ceil((kw * 1000) / 335), serialNumber: `PNL-${assetSeq}-A`, installDate },
          { organizationId: mainOrg.id, installationId: inst.id, kind: "INVERTER", brand: inverter.make, model: inverter.model, quantity: 1, serialNumber: `INV-${assetSeq}-B`, installDate },
        ],
      });

      // warranties — panel product, inverter, service workmanship
      await db.warranty.createMany({
        data: [
          { organizationId: mainOrg.id, installationId: inst.id, kind: "PANEL_PRODUCT", provider: panel.make, coverage: "10-year product warranty on solar modules", startDate: installDate, endDate: daysFromNow(3650 - randInt(200, 1500)), status: "ACTIVE", documentName: "panel-warranty.pdf" },
          { organizationId: mainOrg.id, installationId: inst.id, kind: "INVERTER", provider: inverter.make, coverage: "5-year standard inverter warranty", startDate: installDate, endDate: daysFromNow(1825 - randInt(200, 1500)), status: "ACTIVE", documentName: "inverter-warranty.pdf" },
          { organizationId: mainOrg.id, installationId: inst.id, kind: "SERVICE", provider: "SunRoot Solar Energy", coverage: "2-year workmanship warranty on installation", startDate: installDate, endDate: daysFromNow(730 - randInt(200, 1500)), status: "ACTIVE", documentName: null },
        ],
      });
    }

    // ---------- AMC contracts (~72) ----------
    const amcStatuses = ["ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE", "EXPIRING_SOON", "EXPIRING_SOON", "EXPIRED", "RENEWAL_PENDING", "CANCELLED"];
    const amcs: AmcContract[] = [];
    for (let i = 0; i < 72; i++) {
      const inst = installations[i];
      const status = amcStatuses[i % amcStatuses.length];
      const startOffset = status === "EXPIRED" ? -randInt(400, 500) : -randInt(60, 300);
      const start = daysFromNow(startOffset);
      // EXPIRING_SOON / RENEWAL_PENDING contracts genuinely end within days
      const end =
        status === "EXPIRING_SOON" || status === "RENEWAL_PENDING"
          ? daysFromNow(status === "EXPIRING_SOON" ? randInt(4, 28) : randInt(10, 45))
          : new Date(start.getTime() + 365 * 86400000);
      const interval = pick([90, 120, 180, 180]);
      amcs.push(
        await db.amcContract.create({
          data: {
            organizationId: mainOrg.id,
            customerId: inst.customerId,
            installationId: inst.id,
            contractCode: `AMC-${start.getFullYear()}-${String(i + 1).padStart(4, "0")}`,
            startDate: start,
            endDate: end,
            visitIntervalDays: interval,
            coveredVisits: Math.max(1, Math.round(365 / interval)),
            visitsUsed: randInt(0, 2),
            includedServices: JSON.stringify(INCLUDED_SERVICES),
            excludedServices: JSON.stringify(EXCLUDED_SERVICES),
            emergencyTat: pick(["24 hours", "48 hours"]),
            price: randInt(4, 15) * 1000,
            status,
            documentName: `amc-${i + 1}.pdf`,
          },
        })
      );
    }

    // ---------- maintenance plans + occurrences ----------
    const plans: { plan: MaintenancePlan; amc: AmcContract }[] = [];
    for (const amc of amcs.slice(0, 60)) {
      if (amc.status === "CANCELLED") continue;
      const plan = await db.maintenancePlan.create({
        data: {
          organizationId: mainOrg.id,
          installationId: amc.installationId,
          amcContractId: amc.id,
          name: `${amc.visitIntervalDays}-day preventive maintenance`,
          intervalDays: amc.visitIntervalDays,
          startDate: amc.startDate,
          active: amc.status !== "EXPIRED",
        },
      });
      plans.push({ plan, amc });
    }
    // occurrence states: UPCOMING / DUE / OVERDUE / COMPLETED / RESCHEDULED
    const occStates = ["UPCOMING", "UPCOMING", "UPCOMING", "DUE", "OVERDUE", "COMPLETED", "COMPLETED", "RESCHEDULED"];
    for (let i = 0; i < plans.length; i++) {
      const { plan } = plans[i];
      const state = occStates[i % occStates.length];
      let due: Date;
      let completedAt: Date | null = null;
      let rescheduledFrom: Date | null = null;
      switch (state) {
        case "UPCOMING": due = daysFromNow(randInt(3, 60)); break;
        case "DUE": due = new Date(); due.setHours(9, 0, 0, 0); break;
        case "OVERDUE": due = daysFromNow(-randInt(2, 25)); break;
        case "COMPLETED": { due = daysFromNow(-randInt(10, 90)); completedAt = new Date(due.getTime() + 3 * 3600000); break; }
        case "RESCHEDULED": { const orig = daysFromNow(-3); rescheduledFrom = orig; due = daysFromNow(randInt(4, 15)); break; }
        default: due = daysFromNow(30);
      }
      await db.maintenanceOccurrence.create({
        data: {
          organizationId: mainOrg.id,
          planId: plan.id,
          installationId: plan.installationId,
          dueDate: due,
          status: state,
          completedAt,
          rescheduledFrom,
          notes: state === "COMPLETED" ? "Visit completed as per checklist." : null,
        },
      });
    }

    // ---------- service requests (32) ----------
    const catKeys = Object.keys(REQUEST_DESCRIPTIONS);
    const reqStatuses = ["NEW", "NEW", "NEW", "NEW", "NEW", "NEW", "NEW", "NEW", "UNDER_REVIEW", "UNDER_REVIEW", "UNDER_REVIEW", "UNDER_REVIEW", "UNDER_REVIEW", "UNDER_REVIEW", "APPROVED", "APPROVED", "APPROVED", "APPROVED", "REJECTED", "REJECTED", "CLOSED", "CLOSED"];
    const requests: ServiceRequest[] = [];
    for (let i = 0; i < 32; i++) {
      const cust = customers[i % customers.length];
      const custInsts = installations.filter((x) => x.customerId === cust.id);
      const category = i === 0 ? "INVERTER" : catKeys[i % catKeys.length]; // request 1 becomes demo story
      const status = i < 22 ? reqStatuses[i] : "CONVERTED";
      const createdAt = daysFromNow(-randInt(0, 45), randInt(9, 18));
      requests.push(
        await db.serviceRequest.create({
          data: {
            organizationId: mainOrg.id,
            customerId: cust.id,
            installationId: custInsts[i % Math.max(1, custInsts.length)]?.id ?? null,
            code: `REQ-${String(i + 1).padStart(4, "0")}`,
            category,
            description: REQUEST_DESCRIPTIONS[category][i % REQUEST_DESCRIPTIONS[category].length],
            priority: pick(["LOW", "MEDIUM", "MEDIUM", "HIGH", "URGENT"]),
            status,
            source: pick(["PORTAL", "PORTAL", "PHONE", "EMAIL"]),
            createdAt,
            updatedAt: createdAt,
            reviewNotes: status === "REJECTED" ? "Issue not covered under current AMC terms. Customer informed about paid service." : status !== "NEW" ? "Reviewed by service desk." : null,
            reviewedById: status !== "NEW" ? manager : null,
          },
        })
      );
      await db.jobStatusEvent.create({ data: { organizationId: mainOrg.id, jobId: "seed-placeholder", fromStatus: null, toStatus: "NEW", changedById: manager, note: `Request ${i + 1} recorded`, createdAt } }).catch(() => {});
    }
    // remove placeholder events (jobId not a real FK target yet — delete them)
    await db.jobStatusEvent.deleteMany({ where: { jobId: "seed-placeholder" } });

    // ---------- service jobs (52) ----------
    // distribution: SCHEDULED 8 (unassigned), ASSIGNED 10, IN_PROGRESS 6, WORK_SUBMITTED 4, AWAITING_CUSTOMER 6, COMPLETED 14, NEEDS_REVIEW 2, CANCELLED 2
    const jobPlan: { status: string; count: number }[] = [
      { status: "SCHEDULED", count: 8 },
      { status: "ASSIGNED", count: 10 },
      { status: "IN_PROGRESS", count: 6 },
      { status: "WORK_SUBMITTED", count: 4 },
      { status: "AWAITING_CUSTOMER", count: 6 },
      { status: "COMPLETED", count: 14 },
      { status: "NEEDS_REVIEW", count: 2 },
      { status: "CANCELLED", count: 2 },
    ];
    let jobSeq = 1;
    let techCursor = 0;
    const convertedReqs = requests.filter((r) => r.status === "CONVERTED");
    const notesPool = [
      "Inspected the system thoroughly. Cleaned panels and tightened mounting bolts. Inverter firmware behaviour normal. No faults found.",
      "Identified loose MC4 connector on string 2 causing intermittent shutdown. Reconnected and sealed. System stable after 30-minute observation.",
      "Performed full preventive maintenance. Panels cleaned, structure checked, wiring inspected. Advised customer on seasonal cleaning.",
      "Inverter error E-023 resolved by resetting and reseating DC connectors. Recommended monitoring for one week.",
      "Replaced worn earthing lug and verified continuity. Safety check passed. Explained report to customer.",
    ];
    const followUps = [
      "Recommend replacing DC string cable during next visit.",
      "Suggest scheduling panel deep-cleaning before monsoon.",
      "Follow up on inverter firmware update in 2 weeks.",
    ];

    for (const { status, count } of jobPlan) {
      for (let k = 0; k < count; k++) {
        const req = convertedReqs[(jobSeq - 1) % Math.max(1, convertedReqs.length)];
        const useReq = status !== "SCHEDULED" && req ? req : null;
        const inst = installations[(jobSeq * 7) % installations.length];
        const custId = inst.customerId;
        const isMaintenance = status !== "SCHEDULED" && jobSeq % 3 === 0;
        const scheduled = status === "COMPLETED" || status === "CANCELLED" ? daysFromNow(-randInt(5, 40)) : status === "SCHEDULED" ? daysFromNow(randInt(1, 14)) : status === "ASSIGNED" ? daysFromNow(randInt(0, 6)) : daysFromNow(-randInt(0, 4));
        const tech = techIds[techCursor++ % techIds.length];
        const assigned = status !== "SCHEDULED";
        const started = ["IN_PROGRESS", "WORK_SUBMITTED", "AWAITING_CUSTOMER", "COMPLETED"].includes(status);
        const submitted = ["WORK_SUBMITTED", "AWAITING_CUSTOMER", "COMPLETED"].includes(status);
        const completed = status === "COMPLETED";
        const job = await db.serviceJob.create({
          data: {
            organizationId: mainOrg.id,
            requestId: useReq && !isMaintenance ? useReq.id : null,
            customerId: custId,
            installationId: inst.id,
            code: `JOB-${String(jobSeq).padStart(4, "0")}`,
            title: isMaintenance ? "Preventive maintenance visit" : `${REQUEST_DESCRIPTIONS[useReq?.category ?? "MAINTENANCE"][0].slice(0, 48)}…`,
            description: isMaintenance ? "Scheduled preventive maintenance visit as per AMC plan." : useReq?.description ?? "Service visit.",
            type: isMaintenance ? "MAINTENANCE" : "COMPLAINT",
            priority: pick(["LOW", "MEDIUM", "MEDIUM", "HIGH"]),
            status,
            scheduledFor: scheduled,
            startedAt: started ? new Date(scheduled.getTime() + 3600000) : null,
            submittedAt: submitted ? new Date(scheduled.getTime() + 4 * 3600000) : null,
            completedAt: completed ? new Date(scheduled.getTime() + 5 * 3600000) : null,
            cancellationReason: status === "CANCELLED" ? "Customer postponed; will be rescheduled next month." : null,
            createdById: manager,
          },
        });
        if (assigned) {
          await db.jobAssignment.create({
            data: { organizationId: mainOrg.id, jobId: job.id, technicianUserId: tech, assignedByUserId: manager },
          });
          if (status === "SCHEDULED") await db.serviceJob.update({ where: { id: job.id }, data: { status: "ASSIGNED" } });
        }
        // status events trail
        const trail: string[] = ["SCHEDULED"];
        if (assigned) trail.push("ASSIGNED");
        if (started) trail.push("IN_PROGRESS");
        if (submitted) trail.push(status === "WORK_SUBMITTED" || status === "AWAITING_CUSTOMER" ? "WORK_SUBMITTED" : "WORK_SUBMITTED");
        if (status === "AWAITING_CUSTOMER") trail.push("AWAITING_CUSTOMER");
        if (completed) trail.push("COMPLETED");
        if (status === "CANCELLED") trail.push("CANCELLED");
        let prev: string | null = null;
        let t = new Date(scheduled.getTime() - 86400000);
        for (const st of trail) {
          await db.jobStatusEvent.create({
            data: { organizationId: mainOrg.id, jobId: job.id, fromStatus: prev, toStatus: st, changedById: st === "ASSIGNED" ? manager : st === "IN_PROGRESS" || st === "WORK_SUBMITTED" ? tech : manager, note: null, createdAt: t },
          });
          prev = st;
          t = new Date(t.getTime() + 3600000);
        }

        // checklist results + photos + report for submitted+ jobs
        if (submitted && status !== "CANCELLED") {
          const checklist = isMaintenance ? MAINTENANCE_CHECKLIST : COMPLAINT_CHECKLIST;
          for (const item of checklist) {
            await db.jobChecklistResult.create({
              data: {
                organizationId: mainOrg.id,
                jobId: job.id,
                itemLabel: item.label,
                itemKind: item.kind,
                value: item.kind === "BOOLEAN" ? "true" : (status === "COMPLETED" ? "System performing normally after service." : "Replaced connector; advised monitoring."),
              },
            });
          }
          const photoCaption = isMaintenance ? "Panels after cleaning" : "Faulty connector replaced";
          const att = await db.serviceAttachment.create({
            data: {
              organizationId: mainOrg.id,
              jobId: job.id,
              kind: "PHOTO",
              fileName: `demo-photo-${jobSeq}.svg`,
              mimeType: "image/svg+xml",
              sizeBytes: 2400,
              dataUrl: syntheticPhoto(photoCaption, 150),
              caption: photoCaption,
              uploadedById: tech,
            },
          });
          const acknowledged = status === "COMPLETED" && jobSeq % 2 === 0;
          await db.serviceReport.create({
            data: {
              organizationId: mainOrg.id,
              jobId: job.id,
              customerId: custId,
              technicianNotes: pick(notesPool),
              summary: "Service completed as per checklist. Details recorded during the visit are attached for your reference.",
              followUpNeeded: jobSeq % 3 === 0,
              followUpNotes: jobSeq % 3 === 0 ? pick(followUps) : null,
              checklistJson: JSON.stringify(checklist.map((c) => ({ label: c.label, kind: c.kind, value: c.kind === "BOOLEAN" ? "true" : "Recorded" }))),
              photosJson: JSON.stringify([{ id: att.id, caption: photoCaption }]),
              acknowledgedByOtp: acknowledged,
              acknowledgedAt: acknowledged ? new Date(scheduled.getTime() + 5 * 3600000) : null,
              publishedAt: new Date(scheduled.getTime() + 4.5 * 3600000),
            },
          });
          if (status === "AWAITING_CUSTOMER") {
            await db.serviceJob.update({ where: { id: job.id }, data: { status: "AWAITING_CUSTOMER" } });
          }
        }
        jobSeq++;
      }
    }
    // mark converted requests
    for (const r of convertedReqs) {
      const hasJob = await db.serviceJob.findFirst({ where: { requestId: r.id } });
      if (hasJob) await db.serviceRequest.update({ where: { id: r.id }, data: { status: "CONVERTED" } });
    }
    // ensure a pending AWAITING_CUSTOMER job exists for demo customer 2 (Vikram)
    const vikram = await db.customer.findFirst({ where: { organizationId: mainOrg.id, email: "customer2@demo.suryadesk.in" } });
    if (vikram) {
      const vInst = await db.installation.findFirst({ where: { organizationId: mainOrg.id, customerId: vikram.id } });
      if (vInst) {
        const awaiting = await db.serviceJob.findFirst({ where: { organizationId: mainOrg.id, status: "AWAITING_CUSTOMER", customerId: vikram.id } });
        if (!awaiting) {
          // create one so the customer portal demo has an OTP-pending report
          const j = await db.serviceJob.create({
            data: {
              organizationId: mainOrg.id, customerId: vikram.id, installationId: vInst.id,
              code: `JOB-${String(jobSeq).padStart(4, "0")}`,
              title: "Inverter fault inspection",
              description: "Inverter shows fault code E-023 intermittently.",
              type: "COMPLAINT", priority: "HIGH", status: "AWAITING_CUSTOMER",
              scheduledFor: daysFromNow(-1), startedAt: daysFromNow(-1), submittedAt: daysFromNow(-1),
              createdById: manager,
            },
          });
          jobSeq++;
          await db.jobAssignment.create({ data: { organizationId: mainOrg.id, jobId: j.id, technicianUserId: techIds[0], assignedByUserId: manager } });
          for (const item of COMPLAINT_CHECKLIST) {
            await db.jobChecklistResult.create({ data: { organizationId: mainOrg.id, jobId: j.id, itemLabel: item.label, itemKind: item.kind, value: item.kind === "BOOLEAN" ? "true" : "Reseated DC connectors; error cleared." } });
          }
          const att = await db.serviceAttachment.create({
            data: { organizationId: mainOrg.id, jobId: j.id, kind: "PHOTO", fileName: "demo-inverter.svg", mimeType: "image/svg+xml", sizeBytes: 2200, dataUrl: syntheticPhoto("Inverter after service", 30), caption: "Inverter after service", uploadedById: techIds[0] },
          });
          await db.serviceReport.create({
            data: {
              organizationId: mainOrg.id, jobId: j.id, customerId: vikram.id,
              technicianNotes: "Found loose DC connector on string 1. Reseated and sealed. Inverter stable after 30-minute observation. No parts required.",
              summary: "The inverter fault was traced to a loose connector and fixed during the visit. Please share the OTP to confirm the service.",
              followUpNeeded: true, followUpNotes: "Monitor inverter for one week; error should not recur.",
              checklistJson: JSON.stringify(COMPLAINT_CHECKLIST.map((c) => ({ label: c.label, kind: c.kind, value: c.kind === "BOOLEAN" ? "true" : "Reseated DC connectors; error cleared." }))),
              photosJson: JSON.stringify([{ id: att.id, caption: "Inverter after service" }]),
              publishedAt: daysFromNow(-1),
            },
          });
        }
      }
    }

    // ---------- notifications ----------
    const notifTargets = [...mainStaff.map((s) => staffUsers[s.email])];
    for (const uid of notifTargets) {
      await db.notification.createMany({
        data: [
          { organizationId: mainOrg.id, userId: uid, kind: "NEW_REQUEST", title: "New service request received", body: "REQ-0001 — Inverter complaint from a Jaipur customer.", entityType: "REQUEST", createdAt: daysFromNow(-2, 9) },
          { organizationId: mainOrg.id, userId: uid, kind: "AMC_REMINDER", title: "AMC expiring soon", body: "3 contracts enter their final month this week.", entityType: "AMC", createdAt: daysFromNow(-1, 10) },
        ],
      });
    }
    for (const t of techIds) {
      await db.notification.create({
        data: { organizationId: mainOrg.id, userId: t, kind: "JOB_ASSIGNED", title: "New job assigned", body: "You have been assigned a maintenance visit. Check today's schedule.", entityType: "JOB", createdAt: daysFromNow(0, 8) },
      });
    }
    for (const email of ["customer@demo.suryadesk.in", "customer2@demo.suryadesk.in"]) {
      const u = await db.user.findUnique({ where: { email } });
      if (u) {
        await db.notification.createMany({
          data: [
            { organizationId: mainOrg.id, userId: u.id, kind: "ACCOUNT", title: "Welcome to the SunRoot customer portal", body: "You can now track installations, service requests and reports.", createdAt: daysFromNow(-30, 11) },
            { organizationId: mainOrg.id, userId: u.id, kind: "AMC_REMINDER", title: "Upcoming maintenance visit", body: "Your next preventive maintenance visit is scheduled soon.", entityType: "AMC", createdAt: daysFromNow(-3, 10) },
          ],
        });
      }
    }

    // ---------- audit events ----------
    await db.auditEvent.createMany({
      data: [
        { organizationId: mainOrg.id, actorUserId: owner, action: "ORG_CREATED", entityType: "ORGANIZATION", entityId: mainOrg.id, detail: "Demo organization seeded", createdAt: daysFromNow(-60, 9) },
        { organizationId: mainOrg.id, actorUserId: manager, action: "JOB_ASSIGNED", entityType: "JOB", detail: "Assigned technician to JOB-0009", createdAt: daysFromNow(-5, 12) },
        { organizationId: mainOrg.id, actorUserId: manager, action: "OTP_VERIFIED", entityType: "JOB", detail: "Customer OTP acknowledgement recorded for a completed visit", createdAt: daysFromNow(-4, 15) },
        { organizationId: mainOrg.id, actorUserId: owner, action: "REPORT_REVIEWED", entityType: "REPORT", detail: "Service report reviewed", createdAt: daysFromNow(-2, 17) },
      ],
    });
  }

  // ---------- secondary org (tenant isolation) ----------
  const secondCustCount = await db.customer.count({ where: { organizationId: secondOrg.id } });
  if (secondCustCount === 0) {
    const secCustomers: Customer[] = [];
    for (const spec of [
      { name: "Farhan Qureshi", email: "farhan.q@mail.example.in", city: "Ahmedabad", phone: "+91 90000 91001" },
      { name: "Nandini Shah", email: "nandini.shah@mail.example.in", city: "Ahmedabad", phone: "+91 90000 91002" },
      { name: "Tushar Bhatt", email: "tushar.b@mail.example.in", city: "Gandhinagar", phone: "+91 90000 91003" },
    ]) {
      secCustomers.push(await db.customer.create({ data: { organizationId: secondOrg.id, name: spec.name, email: spec.email, phone: spec.phone, city: spec.city, address: `${randInt(1, 99)}, Sunrise Park, ${spec.city}`, portalStatus: "NONE" } }));
    }
    const secInsts: Installation[] = [];
    for (let i = 0; i < 4; i++) {
      const cust = secCustomers[i % 3];
      secInsts.push(await db.installation.create({
        data: {
          organizationId: secondOrg.id, customerId: cust.id, assetCode: `ASSET-AHMD-P${String(i + 1).padStart(3, "0")}`,
          siteAddress: cust.address ?? "Ahmedabad", city: cust.city, capacityKw: pick([3, 5, 8]),
          installDate: daysFromNow(-randInt(100, 800)),
          panelMake: "Adani Solar", panelModel: "ASM-330", panelCount: 12, inverterMake: "Growatt", inverterModel: "MIN-5000TL",
          serialNumber: `SN-PULSE-${100 + i}`, status: "ACTIVE",
        },
      }));
    }
    for (let i = 0; i < 3; i++) {
      await db.amcContract.create({
        data: {
          organizationId: secondOrg.id, customerId: secInsts[i].customerId, installationId: secInsts[i].id,
          contractCode: `AMC-PG-${String(i + 1).padStart(4, "0")}`,
          startDate: daysFromNow(-randInt(30, 200)), endDate: daysFromNow(randInt(60, 300)),
          visitIntervalDays: 180, coveredVisits: 2, includedServices: JSON.stringify(INCLUDED_SERVICES), excludedServices: JSON.stringify(EXCLUDED_SERVICES),
          price: 8000, status: i === 2 ? "EXPIRING_SOON" : "ACTIVE",
        },
      });
    }
    for (let i = 0; i < 3; i++) {
      await db.serviceRequest.create({
        data: {
          organizationId: secondOrg.id, customerId: secCustomers[i].id, installationId: secInsts[i].id,
          code: `REQ-PG-${String(i + 1).padStart(4, "0")}`,
          category: pick(["MAINTENANCE", "INVERTER", "CLEANING"]),
          description: "Demo request belonging to a different tenant organization.",
          priority: "MEDIUM", status: i === 0 ? "NEW" : "UNDER_REVIEW", source: "PHONE",
        },
      });
    }
  }

  return { ok: true };
}

// Deletes ONLY the designated demo organizations' business data and reseeds.
// User accounts and sessions survive; memberships are re-created by the seed.
export async function resetDemoOrganizations() {
  const orgs = await db.organization.findMany({ where: { isDemo: true } });
  for (const org of orgs) {
    await db.organization.delete({ where: { id: org.id } }); // cascades business data
  }
  const result = await seedDemoData();
  // log the reset against the freshly seeded orgs (log table has no FK cascade)
  const newOrgs = await db.organization.findMany({ where: { isDemo: true } });
  for (const o of newOrgs) {
    await db.demoResetLog.create({ data: { organizationId: o.id, note: "Demo data was reset and reseeded" } });
  }
  return result;
}
