// ── REPORT GENERATOR ──────────────────────────────────
// Uses Claude API to generate professional engineering report text
// Then populates the firm's Word template with the generated content

const ANTHROPIC_API_KEY = 'sk-ant-api03-placeholder'; // Set via env
const SUPABASE_URL      = 'https://vbaewualqaxhbmqgnhdt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiYWV3dWFscWF4aGJtcWduaGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NzAzNjMsImV4cCI6MjA5MzQ0NjM2M30.8s39SZtGq4r_0NXYhsAU0WdPSGqLfefm2YYK_JXjZbg';

export type ReportData = {
  inspection: {
    date: string;
    report_no: string;
    weather: string;
    site_contact: string;
    contact_phone: string;
    purpose: string;
  };
  projectName: string;
  engineerName: string;
  firmName: string;
  zones: {
    id: string;
    label: string;
    markup_type: string;
    observations: {
      severity: string;
      notes: string;
      transcript: string;
      measurements: { label?: string; type?: string; value: string; unit: string }[];
      photoCount: number;
    }[];
  }[];
};

export type GeneratedReport = {
  executive_summary: string;
  findings: string;
  recommendations: string;
};

// ── CALL CLAUDE TO GENERATE REPORT TEXT ───────────────
export async function generateReportWithAI(data: ReportData): Promise<GeneratedReport> {
  const zonesText = data.zones.map(zone => {
    const obsText = zone.observations.map((obs, i) => {
      const measurements = obs.measurements.map(m =>
        `${m.label || m.type}: ${m.value} ${m.unit}`
      ).join(', ');

      return `  Observation ${i + 1}:
    Severity: ${obs.severity}
    ${obs.transcript ? `Voice note: ${obs.transcript}` : ''}
    ${obs.notes ? `Notes: ${obs.notes}` : ''}
    ${measurements ? `Measurements: ${measurements}` : ''}
    Photos taken: ${obs.photoCount}`;
    }).join('\n');

    return `Zone: ${zone.label} (${zone.markup_type})
${obsText || '  No observations recorded'}`;
  }).join('\n\n');

  const prompt = `You are a professional structural engineer writing a formal site inspection report.

PROJECT: ${data.projectName}
DATE: ${data.inspection.date}
REPORT NO: ${data.inspection.report_no}
WEATHER: ${data.inspection.weather}
SITE CONTACT: ${data.inspection.site_contact}
PURPOSE: ${data.inspection.purpose}
ENGINEER: ${data.engineerName}
FIRM: ${data.firmName}

RAW SITE OBSERVATIONS:
${zonesText}

Generate a professional structural engineering site inspection report with exactly these three sections:

1. EXECUTIVE_SUMMARY: A concise 2-3 paragraph professional summary of the inspection. Include the purpose, scope, overall condition assessment, and any critical findings that require immediate attention.

2. FINDINGS: A detailed professional description of all findings organised by zone. For each zone describe the observed conditions in formal engineering language. Reference measurements and severity appropriately. Do not use bullet points — write in formal paragraphs.

3. RECOMMENDATIONS: Professional engineering recommendations based on the findings. Be specific about urgency, follow-up actions, and any further investigation required. Organised by priority.

Respond ONLY with a JSON object in this exact format:
{
  "executive_summary": "...",
  "findings": "...",
  "recommendations": "..."
}

Use formal structural engineering language. Do not include markdown formatting inside the text fields.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':         'application/json',
      'x-api-key':            ANTHROPIC_API_KEY,
      'anthropic-version':    '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error('AI generation failed');
  }

  const result = await response.json();
  const text   = result.content[0].text;

  // Parse JSON response
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean) as GeneratedReport;
}

// ── POPULATE WORD TEMPLATE ─────────────────────────────
// Downloads the firm's Word template and replaces placeholders
// Returns the populated docx as base64
export async function populateWordTemplate(
  templateUrl: string,
  inspection: ReportData['inspection'],
  projectName: string,
  engineerName: string,
  firmName: string,
  generated: GeneratedReport,
  drawings: string,
): Promise<string> {
  // Download template
  const templateResponse = await fetch(templateUrl, {
    headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
  });

  if (!templateResponse.ok) {
    throw new Error('Could not download template');
  }

  const templateBuffer = await templateResponse.arrayBuffer();
  const templateBase64 = btoa(
    String.fromCharCode(...new Uint8Array(templateBuffer))
  );

  // Use Claude to do the placeholder replacement
  // We send the template as base64 and the replacement values
  // Claude returns the populated content as structured replacements
  const replacements: Record<string, string> = {
    '{{project_name}}':       projectName,
    '{{date}}':               inspection.date,
    '{{report_no}}':          inspection.report_no,
    '{{engineer_name}}':      engineerName,
    '{{firm_name}}':          firmName,
    '{{site_contact}}':       inspection.site_contact || '—',
    '{{contact_phone}}':      inspection.contact_phone || '—',
    '{{weather}}':            inspection.weather || '—',
    '{{purpose}}':            inspection.purpose || '—',
    '{{drawings}}':           drawings || '—',
    '{{executive_summary}}':  generated.executive_summary,
    '{{findings}}':           generated.findings,
    '{{recommendations}}':    generated.recommendations,
    '{{generated_date}}':     new Date().toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' }),
  };

  return JSON.stringify({ templateBase64, replacements });
}