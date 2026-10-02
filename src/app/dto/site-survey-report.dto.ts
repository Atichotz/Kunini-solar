// ===== Site Survey Report — ตรงกับ NestJS module site-survey-reports =====
// payload (ส่งไป backend) ใช้ snake_case ตรงกับ column ใน DB ตาม convention เดียวกับ estimate.dto.ts
// response (รับจาก backend) ใช้ camelCase

/** slot รูปในฟอร์ม — ต้องตรงกับ CHECK ของ site_survey_report_photos.slot และ dto/photo-slot.ts ฝั่ง backend */
export const SITE_SURVEY_PHOTO_SLOTS = [
  'bill',
  'drone',
  'roofSurface',
  'shading',
  'mdb',
  'inverterWall',
  'cableRouting',
] as const;

export type SiteSurveyPhotoSlot = (typeof SITE_SURVEY_PHOTO_SLOTS)[number];

/** ชนิดรูปของ layout option — ต้องตรงกับ CHECK ของ site_survey_report_photos.layout_photo_kind ฝั่ง backend */
export type SiteSurveyLayoutPhotoKind = 'sketch' | 'stringDesign';

// ---------- payload ----------

export interface SiteSurveyReportHeadPayload {
  customer_name: string | null;
  address: string | null;
  /** ISO string (มี timezone) */
  survey_date_time: string | null;
  surveyed_by: string | null;
  avg_monthly_bill: string | null;
  avg_usage_kwh: string | null;
  tariff_type: string | null;

  roof_material_type: string | null;
  roof_condition: string | null;
  roof_pitch: string | null;
  shading_issues: string | null;

  electrical_phase: string | null;
  main_breaker_size: string | null;
  grounding_check: string | null;
  inverter_location: string | null;
  ac_cable_run: string | null;
  dc_cable_run: string | null;

  inverter_brand: string | null;
  inverter_model: string | null;
  inverter_phase: string | null;
  inverter_power_kw: number | null;
  inverter_quantity: number | null;
  inverter_size: string | null;

  has_optimizer: boolean;
  optimizer_brand: string | null;
  optimizer_model: string | null;
  optimizer_quantity: number | null;
  optimizer_ratio: string | null;

  has_battery: boolean;
  battery_brand: string | null;
  battery_model: string | null;
  battery_capacity_kwh: number | null;
  battery_count: number | null;
  battery_voltage_min: number | null;
  battery_voltage_max: number | null;
  battery_current_ah: number | null;
  /** 'YYYY-MM-DD' (วันที่ตามเวลาท้องถิ่น ไม่ผ่าน toISOString เพราะ UTC อาจเลื่อนวัน) */
  battery_install_date: string | null;

  client_notes: string | null;
  notes_for_customer: string | null;
  internal_notes: string | null;
}

export interface SiteSurveyReportLayoutOptionPayload {
  /** มี = แก้ layout เดิม, ไม่มี = สร้างใหม่ — ห้ามส่ง id ฝั่ง client (เช่น 'layout-1') */
  id?: string;
  title: string;
  estimated_capacity: string | null;
  orientation: string | null;
  design_rationale: string | null;
  sort_order: number;
}

export interface SaveSiteSurveyReportPayload {
  customer_id: string;
  /** บังคับตอน PUT — savedAt ที่ได้จาก GET/POST/PUT ล่าสุด (ไม่ใช่ updatedAt ของรูป) */
  expected_saved_at?: string;
  head: SiteSurveyReportHeadPayload;
  layout_options: SiteSurveyReportLayoutOptionPayload[];
}

/** ปลายทางของรูปที่อัปโหลด: อย่างใดอย่างหนึ่งเท่านั้น */
export type SiteSurveyPhotoTarget = { slot: SiteSurveyPhotoSlot } | { layoutOptionId: string; layoutPhotoKind: SiteSurveyLayoutPhotoKind };

// ---------- response ----------

export interface SiteSurveyPhoto {
  id: string;
  /** signed URL อายุ 1 ชั่วโมง; เป็น '' ถ้าไฟล์ใน storage หาย */
  url: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface SiteSurveyLayoutOption {
  id: string;
  title: string;
  estimatedCapacity: string | null;
  orientation: string | null;
  designRationale: string | null;
  sortOrder: number;
  sketchPhotos: SiteSurveyPhoto[];
  stringDesignPhotos: SiteSurveyPhoto[];
}

export interface SiteSurveyReportDetail {
  id: string;
  customerId: string;

  customerName: string | null;
  address: string | null;
  surveyDateTime: string | null;
  surveyedBy: string | null;
  avgMonthlyBill: string | null;
  avgUsageKwh: string | null;
  tariffType: string | null;

  roofMaterialType: string | null;
  roofCondition: string | null;
  roofPitch: string | null;
  shadingIssues: string | null;

  electricalPhase: string | null;
  mainBreakerSize: string | null;
  groundingCheck: string | null;
  inverterLocation: string | null;
  acCableRun: string | null;
  dcCableRun: string | null;

  inverterBrand: string | null;
  inverterModel: string | null;
  inverterPhase: string | null;
  inverterPowerKw: number | null;
  inverterQuantity: number | null;
  inverterSize: string | null;

  hasOptimizer: boolean;
  optimizerBrand: string | null;
  optimizerModel: string | null;
  optimizerQuantity: number | null;
  optimizerRatio: string | null;

  hasBattery: boolean;
  batteryBrand: string | null;
  batteryModel: string | null;
  batteryCapacityKwh: number | null;
  batteryCount: number | null;
  batteryVoltageMin: number | null;
  batteryVoltageMax: number | null;
  batteryCurrentAh: number | null;
  batteryInstallDate: string | null;

  clientNotes: string | null;
  notesForCustomer: string | null;
  internalNotes: string | null;

  photosBySlot: Record<SiteSurveyPhotoSlot, SiteSurveyPhoto[]>;
  /** เรียงตาม sortOrder ซึ่งเท่ากับลำดับที่ส่งใน layout_options */
  layoutOptions: SiteSurveyLayoutOption[];

  createdAt: string;
  createdBy: string | null;
  /** เปลี่ยนเมื่อ save หรือแก้รูป — ใช้โชว์ "แก้ล่าสุดโดย…" เท่านั้น */
  updatedAt: string;
  updatedBy: string | null;
  /** token สำหรับ expected_saved_at — เปลี่ยนเฉพาะตอน save ฟอร์ม */
  savedAt: string;
}

/** แถวเดียวใน History list ของลูกค้า */
export interface SiteSurveyReportSummary {
  id: string;
  customerId: string;
  surveyDateTime: string | null;
  surveyedBy: string | null;
  photoCount: number;
  layoutOptionCount: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** ผลของการอัปโหลด/ลบรูป — ห้ามเอา updatedAt ไปใช้เป็น expected_saved_at */
export interface SiteSurveyReportTouchResult {
  updatedAt: string;
  updatedBy: string | null;
}

export interface UploadSiteSurveyPhotoResult extends SiteSurveyReportTouchResult {
  photo: SiteSurveyPhoto;
}
