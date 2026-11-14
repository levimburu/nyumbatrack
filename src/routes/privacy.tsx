import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  ssr: false,
  component: PrivacyPage,
});

const UPDATED = "14 November 2026";

type Section = { title: string; body: React.ReactNode };

const Table = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <div className="overflow-x-auto my-3">
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr>{head.map((h) => <th key={h} className="text-left p-2 border" style={{ background: "var(--k-F3F4F6)", borderColor: "var(--k-E5E7EB)" }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j} className="p-2 border align-top" style={{ borderColor: "var(--k-E5E7EB)" }}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);

const sections: Section[] = [
  {
    title: "1. Introduction",
    body: (
      <>
        <p>NyumbaTrack is property management software used by landlords, property management companies and agencies, their staff, and tenants in Kenya. This policy explains what personal information we handle, why, who can see it, how we protect it, and what rights you have under the Kenya Data Protection Act, 2019.</p>
        <p>It applies to everyone who uses NyumbaTrack: landlords, company staff, caretakers and tenants.</p>
      </>
    ),
  },
  {
    title: "2. Who is responsible for your information",
    body: (
      <>
        <p>For your account details (name, email, login), NyumbaTrack is the data controller.</p>
        <p>For property, tenant, landlord and rent records entered by a landlord or a management company, that landlord or company decides what is recorded and why, and NyumbaTrack processes it on their behalf. Companies must tell their tenants and landlords how their information is used.</p>
      </>
    ),
  },
  {
    title: "3. What information we collect",
    body: (
      <Table
        head={["Who", "Information"]}
        rows={[
          ["Everyone", "Name, email address, login details, and records of sign-ins and activity in the app."],
          ["Tenants", "Name, contact details, unit, rent amount, lease dates, and rent and payment records."],
          ["Landlords and owners", "Name, contact details, ownership and property details, and payout details. Sensitive details are stored encrypted."],
          ["Companies and staff", "Company profile and licence details, staff names, roles and property assignments."],
          ["Caretakers", "Name and contact details, and the property they look after."],
        ]}
      />
    ),
  },
  {
    title: "4. How we use information",
    body: (
      <ul className="list-disc pl-5 space-y-1">
        <li>To create and run your account and let you sign in.</li>
        <li>To record properties, tenants, rent and statements for landlords and companies.</li>
        <li>To send reminders and notifications about rent, leases and compliance.</li>
        <li>To keep the service secure, prevent misuse and investigate problems.</li>
        <li>To meet our legal obligations.</li>
      </ul>
    ),
  },
  {
    title: "5. Why we are allowed to use it",
    body: (
      <p>We rely on one of these for each use: it is needed to provide the service you signed up for (contract); you agreed (consent); the law requires it (legal obligation); or it is needed to keep the service safe and working (legitimate interest). You can withdraw consent at any time, though some features may then stop working.</p>
    ),
  },
  {
    title: "6. Who can see what",
    body: (
      <>
        <Table
          head={["Role", "What they can see"]}
          rows={[
            ["Tenant", "Only their own tenancy, rent and receipts."],
            ["Landlord", "Their own properties, tenants and rent records."],
            ["Company staff", "Only the properties their company manages. Property managers see only properties assigned to them."],
            ["NyumbaTrack staff", "No access to landlord or tenant records by default. Access needs the company's approval, lasts 12 hours, and every view is logged."],
          ]}
        />
        <p>If a company's access is suspended, its staff can no longer see its records.</p>
      </>
    ),
  },
  {
    title: "7. Who we share with",
    body: (
      <p>We do not sell your information. We use trusted service providers to run NyumbaTrack, including Supabase (database, sign-in and file storage) and Vercel (hosting). They may only use information to provide their service to us. We may also disclose information when the law requires it.</p>
    ),
  },
  {
    title: "8. Storage, security and transfers",
    body: (
      <>
        <ul className="list-disc pl-5 space-y-1">
          <li>Sensitive landlord details are encrypted.</li>
          <li>Ownership documents are kept in private storage and opened only through short-lived links.</li>
          <li>Database rules restrict each person to the records they are allowed to see.</li>
          <li>Connections are encrypted (TLS) and sensitive actions are logged.</li>
        </ul>
        <p className="mt-2">Our service providers' servers may be outside Kenya. Where that happens we make sure the transfer is covered by appropriate safeguards, an adequacy decision, or your consent, as the Act requires.</p>
      </>
    ),
  },
  {
    title: "9. How long we keep information",
    body: (
      <p>We keep information only as long as needed for the purpose it was collected, or as the law requires (for example, financial records). When an account or company is closed, we delete or anonymise its information once those periods end.</p>
    ),
  },
  {
    title: "10. Your rights",
    body: (
      <>
        <p>You may ask to see your information, correct it, delete it, object to how it is used, or receive a copy in a portable format. We answer access requests within 7 days. Tenants and landlords can also contact their own landlord or management company.</p>
        <p>If you are unhappy with how your information is handled, you may complain to the Office of the Data Protection Commissioner (ODPC) at <a href="https://www.odpc.go.ke" className="underline" target="_blank" rel="noreferrer">www.odpc.go.ke</a>.</p>
      </>
    ),
  },
  {
    title: "11. Children",
    body: <p>NyumbaTrack is not for children. If a tenant is under 18, their information should be entered only by a parent or guardian with the authority to do so.</p>,
  },
  {
    title: "12. If something goes wrong",
    body: <p>If a personal data breach puts people at risk, we will notify the ODPC within 72 hours, tell the affected company without delay, and tell affected people as soon as reasonably possible.</p>,
  },
  {
    title: "13. Cookies and browser storage",
    body: <p>We use your browser's storage only to keep you signed in and remember your selected property. We do not use advertising cookies.</p>,
  },
  {
    title: "14. Changes to this policy",
    body: <p>We may update this policy. The date at the top shows when it was last changed, and we will tell you in the app about important changes.</p>,
  },
  {
    title: "15. Contact",
    body: <p>For privacy questions or requests, contact NyumbaTrack through the support option in the app or on our website, <a href="https://app.nyumbatrack.com" className="underline">app.nyumbatrack.com</a>.</p>,
  },
];

function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--k-F9FAFB)", color: "var(--kt-111827)" }}>
      <div className="mx-auto max-w-3xl px-5 py-10">
        <a href="/auth" className="text-sm" style={{ color: "var(--kt-166534)" }}>← Back to NyumbaTrack</a>
        <h1 className="font-display text-3xl font-bold mt-4 mb-1">Privacy Policy</h1>
        <p className="text-sm mb-8" style={{ color: "var(--kt-6B7280)" }}>Last updated: {UPDATED}</p>
        <div className="space-y-7 text-sm leading-relaxed" style={{ color: "var(--kt-374151)" }}>
          {sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <h2 className="text-base font-bold" style={{ color: "var(--kt-111827)" }}>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
        <p className="text-xs mt-10" style={{ color: "var(--kt-9CA3AF)" }}>© 2026 NyumbaTrack Technologies Ltd</p>
      </div>
    </div>
  );
}
