import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy policy · SiteIQ',
  description: 'How SiteIQ collects, uses and protects information.',
}

/*
 * SiteIQ's privacy policy — public, linked from the Google Play and App
 * Store listings (which require one). Written to New Zealand's Privacy Act
 * 2020 and to match what the app and website actually do; review the
 * bracketed items, and have it checked, before publishing.
 */

const CONTACT = 'info@siteiq.com'
const OPERATOR = 'Site IQ'
const UPDATED = '12 October 2026'

const h2: React.CSSProperties = { fontFamily: 'var(--f-heading)', fontSize: 20, fontWeight: 800, color: 'var(--indigo-deep)', margin: '36px 0 10px' }
const p: React.CSSProperties = { margin: '0 0 12px' }
const ul: React.CSSProperties = { margin: '0 0 12px', paddingLeft: 22 }

export default function PrivacyPage() {
  return (
    <main style={{ background: 'var(--paper)', minHeight: '100vh', padding: '48px 16px 80px' }}>
      <article style={{
        maxWidth: 760, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--border-line)',
        borderRadius: 16, padding: 'clamp(24px, 5vw, 48px)', fontFamily: 'var(--f-text)', fontSize: 15,
        lineHeight: 1.65, color: 'var(--text-ink)',
      }}>
        <h1 style={{ fontFamily: 'var(--f-heading)', fontSize: 32, fontWeight: 800, color: 'var(--indigo)', margin: 0 }}>Privacy policy</h1>
        <p style={{ color: 'var(--text-mid)', marginTop: 6 }}>Last updated {UPDATED}</p>

        <p style={p}>
          SiteIQ is a site inspection tool for structural engineering firms: a phone app for recording site visits
          and a website for preparing and issuing reports. It is operated by {OPERATOR} (“we”, “us”). This policy
          explains what information SiteIQ handles, why, who it is shared with, and your rights. We follow New
          Zealand’s Privacy Act 2020.
        </p>
        <p style={p}>
          SiteIQ is used by firms. A firm decides what goes into its projects and reports; we hold and process that
          information on the firm’s behalf. If you have a question about a particular report or project, the firm
          that produced it is usually the best first contact.
        </p>

        <h2 style={h2}>What we collect</h2>
        <ul style={ul}>
          <li><strong>Account details</strong> — your name, email address and password (stored only in hashed form), the firm you belong to and your role.</li>
          <li><strong>Project information</strong> your firm adds — project names, addresses and client contacts, drawings, specifications and consultant advice notices, and report recipients.</li>
          <li><strong>Site records</strong> you make — site visit details, notes, measurements, drawing mark-ups, photos, and voice recordings of dictated notes, which are kept with the note they belong to.</li>
          <li><strong>Reports</strong> generated from those records, and comments and photos added when items are followed up or closed.</li>
          <li><strong>Connected accounts</strong> — if your firm connects Microsoft 365, the access tokens needed to save reports to its OneDrive.</li>
        </ul>
        <p style={p}>We do <strong>not</strong> collect your location, contacts, or advertising or device identifiers, and SiteIQ contains no advertising and no third-party analytics or tracking.</p>

        <h2 style={h2}>Phone permissions</h2>
        <ul style={ul}>
          <li><strong>Camera and photos</strong> — to take or choose photos for site notes.</li>
          <li><strong>Microphone</strong> — to dictate notes. Recording happens only while you are dictating.</li>
          <li><strong>Face ID / fingerprint</strong> — optional, to unlock the app. This is handled by your phone; SiteIQ never receives biometric data.</li>
          <li><strong>Location (iPhone)</strong> — requested only because Apple’s augmented-reality measuring needs it. SiteIQ does not record, store or share your location.</li>
        </ul>

        <h2 style={h2}>How we use it</h2>
        <ul style={ul}>
          <li>To provide SiteIQ: storing your firm’s projects and site records, and producing reports.</li>
          <li>To turn dictation into text. This is done on your phone where possible; with a connection, the recording may instead be sent to our transcription provider.</li>
          <li>To draft report wording, short summaries and descriptions, and to read drawings and advice notices, using an AI provider. An engineer reviews and finalises every report.</li>
          <li>To keep the service secure, and to contact you about your account.</li>
        </ul>
        <p style={p}>We do not sell your information, and we do not use it for advertising or to train AI models.</p>

        <h2 style={h2}>Who it is shared with</h2>
        <p style={p}>Within SiteIQ, a firm’s information is visible only to that firm’s members. Reports go to the people your firm chooses to send them to. We use these service providers to run SiteIQ, each only for the purpose listed:</p>
        <ul style={ul}>
          <li><strong>Supabase</strong> — database, file storage and sign-in.</li>
          <li><strong>Vercel</strong> — hosting the website and its services.</li>
          <li><strong>DigitalOcean</strong> — hosting the document editor used to prepare reports.</li>
          <li><strong>OpenAI</strong> — transcribing dictation sent from the app.</li>
          <li><strong>Anthropic</strong> — AI drafting and reading of documents.</li>
          <li><strong>Microsoft</strong> — only if your firm connects Microsoft 365.</li>
        </ul>
        <p style={p}>
          Some of these providers store or process information outside New Zealand, including in Australia and the
          United States. We use providers whose terms require them to protect it in ways comparable to New Zealand’s
          Privacy Act. We may also disclose information where the law requires it.
        </p>

        <h2 style={h2}>On your phone</h2>
        <p style={p}>
          So it works with no signal, the app keeps a copy of the projects you open or download, your site records
          until they upload, and your sign-in. Downloaded copies can be removed in the app (Profile → Offline &amp;
          uploads). A PIN you set for the app is stored only on your phone.
        </p>

        <h2 style={h2}>How long we keep it</h2>
        <p style={p}>
          Project information, site records and reports are kept for as long as your firm uses SiteIQ, so that its
          reports remain a record of its work, unless the firm deletes them sooner. Deleting a note, report or project
          removes its photos and recordings too. When a firm stops using SiteIQ, its information is deleted on request.
        </p>

        <h2 style={h2} id="delete">Deleting your account</h2>
        <p style={p}>
          To delete your SiteIQ account, email <strong>{CONTACT}</strong> from the address you sign in with, or ask
          your firm’s SiteIQ administrator, who can remove you from the firm. We delete your account details within
          30 days. Site records you made for your firm belong to the firm’s projects and stay with them unless the firm
          deletes them.
        </p>

        <h2 style={h2}>Security</h2>
        <p style={p}>
          Information is encrypted in transit, and access is restricted so that each firm sees only its own
          information. No system is perfectly secure; if a breach is likely to cause serious harm, we will notify the
          people affected and the Privacy Commissioner as the Privacy Act requires.
        </p>

        <h2 style={h2}>Your rights</h2>
        <p style={p}>
          You can ask to see the personal information we hold about you and to have it corrected, by emailing{' '}
          <strong>{CONTACT}</strong>. If you are not satisfied with our response, you can complain to the Office of the
          Privacy Commissioner (privacy.org.nz).
        </p>

        <h2 style={h2}>Children</h2>
        <p style={p}>SiteIQ is a professional tool and is not intended for anyone under 16.</p>

        <h2 style={h2}>Changes</h2>
        <p style={p}>If we change this policy, we will update the date above and, for significant changes, tell firms using SiteIQ.</p>

        <h2 style={h2}>Contact</h2>
        <p style={{ ...p, marginBottom: 0 }}>{OPERATOR} · {CONTACT}</p>
      </article>
    </main>
  )
}
