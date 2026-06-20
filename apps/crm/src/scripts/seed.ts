import { isNull } from "drizzle-orm";
import type { CrmDb } from "../db/types.js";
import * as schema from "../db/schema.js";
import { withAudit } from "@skarion/db-kit";

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000001";

const demoCompanies = [
  { name: "Acme Corp", domain: "acme.com", industry: "Manufacturing", size: "201-500", address: { street: "123 Main St", city: "New York", state: "NY", zip: "10001", country: "USA" } },
  { name: "TechStart Inc", domain: "techstart.io", industry: "Technology", size: "11-50", address: { street: "456 Innovation Blvd", city: "San Francisco", state: "CA", zip: "94105", country: "USA" } },
  { name: "Global Logistics Ltd", domain: "globallogistics.com", industry: "Logistics", size: "500+", address: { street: "789 Port Way", city: "Miami", state: "FL", zip: "33101", country: "USA" } },
  { name: "Green Energy Solutions", domain: "greenenergy.solutions", industry: "Energy", size: "51-200", address: { street: "321 Solar Ave", city: "Austin", state: "TX", zip: "78701", country: "USA" } },
  { name: "MediCare Plus", domain: "medicareplus.health", industry: "Healthcare", size: "201-500", address: { street: "654 Health Blvd", city: "Boston", state: "MA", zip: "02101", country: "USA" } },
];

const demoContacts = [
  { firstName: "John", lastName: "Smith", email: "john.smith@acme.com", phone: "+1-555-0101", title: "CEO" },
  { firstName: "Sarah", lastName: "Johnson", email: "sarah.j@techstart.io", phone: "+1-555-0102", title: "CTO" },
  { firstName: "Mike", lastName: "Williams", email: "mike.w@globallogistics.com", phone: "+1-555-0103", title: "COO" },
  { firstName: "Emily", lastName: "Chen", email: "emily.chen@greenenergy.solutions", phone: "+1-555-0104", title: "VP Sales" },
  { firstName: "David", lastName: "Brown", email: "david.brown@medicareplus.health", phone: "+1-555-0105", title: "Director" },
  { firstName: "Lisa", lastName: "Davis", email: "lisa.davis@acme.com", phone: "+1-555-0106", title: "Manager" },
  { firstName: "Robert", lastName: "Miller", email: "robert.m@techstart.io", phone: "+1-555-0107", title: "Engineer" },
  { firstName: "Jennifer", lastName: "Wilson", email: "jennifer@globallogistics.com", phone: "+1-555-0108", title: "Account Executive" },
];

const demoLeads = [
  { firstName: "Alex", lastName: "Thompson", email: "alex.t@newco.com", phone: "+1-555-0201", companyName: "NewCo Ventures", companyDomain: "newco.com", source: "website" as const, status: "new" as const, notes: "Interested in enterprise plan" },
  { firstName: "Maria", lastName: "Garcia", email: "maria.g@startup.xyz", phone: "+1-555-0202", companyName: "Startup XYZ", companyDomain: "startup.xyz", source: "referral" as const, status: "contacted" as const, notes: "Referred by John Smith" },
  { firstName: "James", lastName: "Lee", email: "james.lee@techflow.com", phone: "+1-555-0203", companyName: "TechFlow", companyDomain: "techflow.com", source: "cold_call" as const, status: "qualified" as const, notes: "Budget confirmed, evaluating options" },
  { firstName: "Anna", lastName: "Martinez", email: "anna.m@buildcorp.com", phone: "+1-555-0204", companyName: "BuildCorp", companyDomain: "buildcorp.com", source: "email_campaign" as const, status: "new" as const, notes: "Downloaded whitepaper" },
  { firstName: "Chris", lastName: "Anderson", email: "chris.a@cloudsys.io", phone: "+1-555-0205", companyName: "CloudSys", companyDomain: "cloudsys.io", source: "event" as const, status: "contacted" as const, notes: "Met at Cloud Expo 2025" },
  { firstName: "Patricia", lastName: "Taylor", email: "patricia.t@dataworks.com", phone: "+1-555-0206", companyName: "DataWorks", companyDomain: "dataworks.com", source: "social_media" as const, status: "disqualified" as const, notes: "Budget too small" },
];

const demoOpportunities = [
  { name: "Acme Enterprise Deal", stage: "negotiation" as const, amount: "150000.00", currency: "USD" as const, expectedCloseDate: "2025-08-15", probability: 75, notes: "Final pricing discussion" },
  { name: "TechStart SaaS License", stage: "proposal" as const, amount: "45000.00", currency: "USD" as const, expectedCloseDate: "2025-07-30", probability: 60, notes: "Multi-year contract" },
  { name: "Global Logistics Integration", stage: "qualification" as const, amount: "250000.00", currency: "USD" as const, expectedCloseDate: "2025-09-01", probability: 40, notes: "Complex integration requirements" },
  { name: "Green Energy Pilot", stage: "prospecting" as const, amount: "30000.00", currency: "USD" as const, expectedCloseDate: "2025-10-15", probability: 25, notes: "Pilot program for 6 months" },
  { name: "MediCare Plus Rollout", stage: "closed_won" as const, amount: "500000.00", currency: "USD" as const, expectedCloseDate: "2025-06-01", probability: 100, notes: "Full hospital network deployment" },
  { name: "CloudSys Migration", stage: "closed_lost" as const, amount: "80000.00", currency: "USD" as const, expectedCloseDate: "2025-05-15", probability: 0, notes: "Lost to competitor pricing" },
];

const demoActivities = [
  { type: "call" as const, subject: "Initial discovery call with Acme", content: "Discussed their current pain points and requirements. Very interested in our enterprise solution.", contactId: 0, companyId: 0, opportunityId: null },
  { type: "email" as const, subject: "Follow-up: TechStart proposal", content: "Sent pricing details and case studies. Awaiting their internal review.", contactId: 1, companyId: 1, opportunityId: null },
  { type: "meeting" as const, subject: "Product demo for Global Logistics", content: "Demonstrated our integration capabilities. Positive feedback from their technical team.", contactId: 2, companyId: 2, opportunityId: null },
  { type: "note" as const, subject: "Green Energy budget confirmed", content: "VP confirmed $30K budget for pilot program. Need to send contract by Friday.", contactId: 3, companyId: 3, opportunityId: null },
  { type: "call" as const, subject: "MediCare contract negotiation", content: "Finalized terms for the $500K deal. Legal review in progress.", contactId: 4, companyId: 4, opportunityId: null },
];

const demoTasks = [
  { title: "Send Acme proposal", description: "Prepare and send detailed proposal for enterprise plan", priority: "high" as const, contactId: 0, companyId: 0, opportunityId: 0 },
  { title: "Schedule TechStart demo", description: "Coordinate with their engineering team for technical demo", priority: "medium" as const, contactId: 1, companyId: 1, opportunityId: 1 },
  { title: "Follow up on Global Logistics integration", description: "Send technical documentation and integration guide", priority: "high" as const, contactId: 2, companyId: 2, opportunityId: 2 },
  { title: "Prepare Green Energy pilot contract", description: "Draft contract for 6-month pilot program", priority: "medium" as const, contactId: 3, companyId: 3, opportunityId: 3 },
  { title: "Coordinate MediCare deployment kickoff", description: "Schedule kickoff meeting with their IT team", priority: "urgent" as const, contactId: 4, companyId: 4, opportunityId: 4 },
  { title: "Review CloudSys lost deal analysis", description: "Document why we lost and identify lessons learned", priority: "low" as const, contactId: null, companyId: null, opportunityId: 5 },
];

export async function seed(db: CrmDb): Promise<void> {
  console.log("Seeding CRM demo data...");

  const existing = await db.select().from(schema.companies).where(isNull(schema.companies.deletedAt)).limit(1);
  if (existing.length > 0) {
    console.log("CRM already has data. Skipping seed.");
    return;
  }

  const companyRows = await db.insert(schema.companies).values(
    demoCompanies.map(c => ({ ...c, ownerId: DEMO_USER_ID }))
  ).returning();
  console.log(`Inserted ${companyRows.length} companies`);

  const contactRows = await db.insert(schema.contacts).values(
    demoContacts.map((c, i) => ({
      ...c,
      companyId: companyRows[i % companyRows.length]!.id,
      ownerId: DEMO_USER_ID,
    }))
  ).returning();
  console.log("Inserted " + contactRows.length + " contacts");

  const leadRows = await db.insert(schema.leads).values(
    demoLeads.map(l => ({ ...l, ownerId: DEMO_USER_ID }))
  ).returning();
  console.log("Inserted " + leadRows.length + " leads");

  const oppRows = await db.insert(schema.opportunities).values(
    demoOpportunities.map((o, i) => ({
      ...o,
      companyId: companyRows[i % companyRows.length]!.id,
      contactId: contactRows[i % contactRows.length]!.id,
      ownerId: DEMO_USER_ID,
    }))
  ).returning();
  console.log("Inserted " + oppRows.length + " opportunities");

  await db.insert(schema.activities).values(
    demoActivities.map((a, i) => ({
      ...a,
      contactId: a.contactId !== null ? contactRows[a.contactId]!.id : null,
      companyId: a.companyId !== null ? companyRows[a.companyId]!.id : null,
      opportunityId: a.opportunityId !== null ? oppRows[i % oppRows.length]!.id : null,
      actorId: DEMO_USER_ID,
    }))
  );
  console.log(`Inserted ${demoActivities.length} activities`);

  await db.insert(schema.tasks).values(
    demoTasks.map((t, i) => ({
      ...t,
      contactId: t.contactId !== null ? contactRows[t.contactId]!.id : null,
      companyId: t.companyId !== null ? companyRows[t.companyId]!.id : null,
      opportunityId: t.opportunityId !== null ? oppRows[t.opportunityId]!.id : null,
      assigneeId: DEMO_USER_ID,
      dueDate: new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000),
    }))
  );
  console.log(`Inserted ${demoTasks.length} tasks`);

  await withAudit(db, schema.auditLog, {
    actorUserId: DEMO_USER_ID,
    action: "seed",
    resourceType: "crm",
    resourceId: "all",
    app: "crm",
  });

  console.log("CRM seed complete!");
}
