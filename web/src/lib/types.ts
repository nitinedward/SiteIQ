export type Inspection = {
  id: string
  project_id: string
  date: string
  report_no: string
  weather: string
  site_contact: string
  contact_phone: string
  purpose: string
  drawing_ref: string
  status: 'IN_PROGRESS' | 'COMPLETED'
  created_at: string
}

export type Project = {
  id: string
  name: string
  project_number: string
  address: string
  client: string
  firm_id: string
}

export type Zone = {
  id: string
  label: string
  x_percent: number
  y_percent: number
  markup_type: 'pin' | 'rectangle' | 'freehand'
  shape_data: string | null
  drawing_id: string
  inspection_id: string
}

export type Observation = {
  id: string
  zone_id: string
  inspection_id: string
  zone_label: string
  notes: string
  transcript: string
  severity: string
  photos: string[]
  measurements: any[]
}

export type Drawing = {
  id: string
  title: string
  number: string
  file_url: string
  project_id: string
}

export type Firm = {
  id: string
  name: string
  join_code: string
  report_template_url: string | null
}