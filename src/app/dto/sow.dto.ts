// ===== Scope of Work — ตรงกับ NestJS module sows =====
// payload (ส่งไป backend) ใช้ snake_case ตรงกับ column ใน DB ตาม convention เดียวกับ site-survey-report.dto.ts
// response (รับจาก backend) ใช้ camelCase
// วันที่ทุกตัวเป็น 'YYYY-MM-DD' (ไม่ใช่ ISO timestamp) — column เป็น date กันวันเลื่อนข้ามวันเพราะ timezone

/** ต้องตรงกับ CHECK ของ sow_days.status และ SOW_DAY_STATUSES ฝั่ง backend */
export const SOW_DAY_STATUSES = ['Pending', 'In Progress', 'Completed', 'Delayed'] as const;
export type SowDayStatus = (typeof SOW_DAY_STATUSES)[number];

/** ต้องตรงกับ CHECK ของ sow_eod_reports.weather และ SOW_WEATHERS ฝั่ง backend */
export type SowWeather = 'clear' | 'overcast' | 'rain';

export interface SowMachineryFlags {
  scaffolding: boolean;
  mobileCrane: boolean;
  boomLift: boolean;
  fallProtection: boolean;
  generator: boolean;
}

// ---------- payload ----------

export interface SowTaskPayload {
  /** มี = แก้ task เดิม, ไม่มี = สร้างใหม่ (task เดิมที่ไม่อยู่ใน array = ถูกลบ) */
  id?: string;
  text: string;
}

export interface SowDayPayload {
  id?: string;
  day_date: string | null;
  status: SowDayStatus;
  headcount: number | null;
  lead_tech: string | null;
  subcontractor_notes: string | null;
  machinery: SowMachineryFlags;
  machinery_notes: string | null;
  tasks: SowTaskPayload[];
}

export interface SowEodReportPayload {
  id?: string;
  report_date: string | null;
  weather: SowWeather;
  progress_notes: string | null;
}

export interface SaveSowPayload {
  customer_id: string;
  /** savedAt ที่ได้รับล่าสุด — บังคับเฉพาะตอน PUT (ไม่ตรง = 409) */
  expected_saved_at?: string;
  head: {
    planned_start_date: string | null;
    est_completion_date: string | null;
    customer_notes: string | null;
    final_notes: string | null;
  };
  days: SowDayPayload[];
  eod_reports: SowEodReportPayload[];
}

// ---------- response ----------

export interface SowPhoto {
  id: string;
  url: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface SowTask {
  id: string;
  text: string;
}

export interface SowDay {
  id: string;
  date: string | null;
  status: SowDayStatus;
  headcount: number | null;
  leadTech: string | null;
  subcontractorNotes: string | null;
  machinery: SowMachineryFlags;
  machineryNotes: string | null;
  tasks: SowTask[];
}

export interface SowEodReport {
  id: string;
  date: string | null;
  weather: SowWeather;
  progressNotes: string | null;
  photos: SowPhoto[];
}

export interface SowDetail {
  id: string;
  customerId: string;
  plannedStartDate: string | null;
  estCompletionDate: string | null;
  customerNotes: string | null;
  finalNotes: string | null;
  days: SowDay[];
  eodReports: SowEodReport[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  /** token เช็คชนกัน — ส่งกลับเป็น expected_saved_at ตอน PUT เท่านั้น ห้ามใช้ updatedAt แทน */
  savedAt: string;
}

export interface SowSummary {
  id: string;
  customerId: string;
  plannedStartDate: string | null;
  estCompletionDate: string | null;
  dayCount: number;
  eodReportCount: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SowTouchResult {
  updatedAt: string;
  updatedBy: string | null;
}

export interface UploadSowPhotoResult extends SowTouchResult {
  photo: SowPhoto;
}
