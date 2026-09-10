import { prisma } from "../src/lib/prisma";

// Source: "Parters Lists Final.docx" (2026-08-01) — a 30-row table of
// partner recruitment/travel agencies, extracted via python-docx. The
// source has no phone number or partner-type column at all; per the
// business, contact_phone gets a visible "N/A" placeholder (director
// fills in the real number per-partner later, same as any other Partner
// edit) and partner_type defaults to "manpower_supplier" for every row
// (matches the predominant nature of these agencies — it's a display
// label only, not tied to any permission logic, so easy to correct
// individually later if wrong for a specific partner). "Position"
// (all "CEO" in the source) has no corresponding Partner field and is
// intentionally dropped.
//
// Deliberately does NOT call the account-provisioning flow
// (POST /api/admin/partners/:id/provision-account) — these rows are
// created with user_id left null, so no invite email goes out. The
// director sends that themselves, per-partner, via "Create Partner
// Login" on /management/partners/[id] whenever they're ready.
const PARTNERS: {
  country: string;
  company: string;
  email: string;
  contact: string;
}[] = [
  { country: "Ghana", company: "Sanisa Recruitment", email: "info@sanisarecruitment.com", contact: "Louisa Brago" },
  { country: "Ghana", company: "Secure Travel & Tours", email: "info@securetravelandtours.com", contact: "Lawrence Dogah" },
  { country: "Ghana", company: "Partners Recruit", email: "jmawutor@partnersrecruit.com", contact: "Joshua Mawutor" },
  { country: "Nigeria", company: "Freelancecruit Ltd.", email: "freelancecruit@gmail.com", contact: "Tosin Gabriel Adeniyi" },
  { country: "Gambia", company: "Outsource Recruitment", email: "info@outsourcerecruit.gm", contact: "Momodou Camara" },
  { country: "Morocco", company: "Addwork", email: "younes@addwork.ma", contact: "Younes Sahsah" },
  { country: "Ghana", company: "HR-I Solutions", email: "b.naabu@hrisolutionsgh.com", contact: "Benjamin Naabu" },
  { country: "Kenya", company: "Awards Recruitment", email: "monicah@awardsrecruitment.com", contact: "Peterson Mwangi" },
  { country: "Kenya", company: "Finstock Talent Recruitment", email: "finstocktalentrecruitment@gmail.com", contact: "John Finstock" },
  { country: "Angola", company: "Administração Premier Yangue", email: "administracao@premieryangue.ao", contact: "Maria Mallett" },
  { country: "Rwanda", company: "360Askme", email: "ceo@360askme.com", contact: "Mr. Aloys Ntezimana" },
  { country: "Togo", company: "Global Travel Agency Team", email: "info@gta.tg", contact: "Edem Kpomassi" },
  { country: "Rwanda", company: "Xander Global Scholars", email: "info@xanderglobalscholars.com", contact: "Jean Hakizimana" },
  { country: "Kenya", company: "Homebound Agenciey Ltd.", email: "info@homeboundagencies.co.ke", contact: "Dr. Peris Mburu" },
  { country: "Benin", company: "Legend Services", email: "kododjiosseni@gmail.com", contact: "Osseni Kododji" },
  { country: "Cameroon", company: "Amigo Consulting", email: "teams-cameroon@amigoconsultingcm.com", contact: "Nchinche Pascal" },
  { country: "Egypt", company: "Work Future", email: "info@wf-staffing.com", contact: "Hanan Ibrahim" },
  { country: "Kenya", company: "Trust Destiny Travel", email: "trustdestinytravel@gmail.com", contact: "Walter Willies K. Njoroge" },
  { country: "Egypt", company: "Rawaj Egypt", email: "info@rawaj-egypt.com", contact: "Mr. Adel Mansour" },
  { country: "Burundi", company: "Mountain Ventures", email: "bonaventurenick20@gmail.com", contact: "Bonaventure Nick Niyomwungere" },
  { country: "Sierra Leone", company: "Gulf Jobs Hunt", email: "gulfjobshuntshrconsultancyrecr@gmail.com", contact: "Alimamy Sankoh" },
  { country: "Cameroon", company: "Universal Business Tours", email: "contact@universalbusinesstours.com", contact: "Yvette Mamgue" },
  { country: "Rwanda", company: "Study Work Abroad Experts", email: "info@studyworkabroad.net", contact: "Mutokambare Methode" },
  { country: "Bangladesh", company: "South Asian International LTD", email: "sail.manpower17@gmail.com", contact: "Mr. Kalibad" },
  { country: "Burundi", company: "Top Job Express Co.", email: "topjobexpressco2025@gmail.com", contact: "Philippe Mundeke" },
  { country: "Cameroon", company: "FAQ Travel", email: "voyagefaq@gmail.com", contact: "Idaina Fofoue" },
  { country: "Ghana", company: "SARP Solutions", email: "ps.ocrah@sarpsolutions.com", contact: "Priscilla Santuo Ocrah" },
  { country: "Bolivia", company: "Visas y Tramites", email: "paovisasytramites@gmail.com", contact: "Paola Andrea Astroga Murillo" },
  { country: "Uganda", company: "Explorer Dubai", email: "wanyamamark@gmail.com", contact: "Wanyama Mark" },
  { country: "Nigeria", company: "Thirteen Universal", email: "timothy@thirteenuniversal.com.ng", contact: "Timothy A. Adekunle" },
];

async function main() {
  let created = 0;
  let skipped = 0;

  for (const p of PARTNERS) {
    const existing = await prisma.partner.findFirst({ where: { contact_email: p.email } });
    if (existing) {
      console.log(`- ${p.company}: already exists, skipped`);
      skipped++;
      continue;
    }

    await prisma.partner.create({
      data: {
        name: p.company,
        partner_type: "manpower_supplier",
        country_of_operation: p.country,
        contact_name: p.contact,
        contact_email: p.email,
        contact_phone: "N/A",
        status: "pending",
        mou_status: "none",
      },
    });
    console.log(`✓ ${p.company} (${p.country})`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} already existed.`);
}

main().finally(() => prisma.$disconnect());
