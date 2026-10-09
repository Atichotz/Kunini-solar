// สัญญาระหว่าง frontend ↔ backend ของ Installation Report (/installation-reports)
// ชื่อ field ฝั่ง request เป็น snake_case ตรงกับ backend DTO, ฝั่ง response เป็น camelCase

export const INSTALLATION_PHOTO_SLOTS = ['sld', 'roof', 'equipment'] as const;
export type InstallationPhotoSlot = (typeof INSTALLATION_PHOTO_SLOTS)[number];

export const INSTALLATION_SERIAL_GROUPS = ['inverter', 'battery', 'panel', 'optimizer'] as const;
export type InstallationSerialGroup = (typeof INSTALLATION_SERIAL_GROUPS)[number];

export type InstallationComponentGroup = 'array' | 'powerStorage';
export type InstallationCheckGroup = 'commissioning' | 'permit' | 'backup' | 'load';
export type InstallationInstallerInputType = 'text' | 'check';

// ---------- request ----------

// ทุก field ส่งเสมอ (ค่าว่าง = null) เพราะ PUT เป็น full replace
export interface InstallationReportHeadPayload {
  customer_name: string | null;
  address: string | null;
  /** 'YYYY-MM-DD' (วันที่ตามเวลาท้องถิ่น ไม่ผ่าน toISOString เพราะ UTC อาจเลื่อนวัน) */
  completion_date: string | null;
  technician: string | null;
  weather_conditions: string | null;

  system_type: string | null;
  total_dc_capacity: string | null;
  ac_output: string | null;

  total_pv_panels: number | null;
  dc_fuse_specs: string | null;
  dc_surge_specs: string | null;
  dc_input_watts: string | null;
  ac_surge_specs: string | null;
  total_amps: string | null;
  technician_notes: string | null;

  /** 'YYYY-MM-DD' */
  next_maintenance_date: string | null;
}

export interface InstallationComponentPayload {
  group_key: InstallationComponentGroup;
  qty: string | null;
  name: string | null;
  detail: string | null;
}

export interface InstallationInstallerRowPayload {
  section: string;
  component: string;
  description: string;
  input_type: InstallationInstallerInputType;
  value: string | null;
  checked: boolean;
}

export interface InstallationDcStringPayload {
  mppt: string | null;
  string_no: string | null;
  panels_per_string: number | null;
  voc_nominal: string | null;
  vdc_reading: string | null;
  amp_reading: string | null;
  reading_time: string | null;
}

export interface InstallationAcPhasePayload {
  phase: string | null;
  amp_reading: string | null;
  voltage_reading: string | null;
}

export interface InstallationCheckPayload {
  group_key: InstallationCheckGroup;
  label: string;
  checked: boolean;
  value: string | null;
}

export interface InstallationSerialPayload {
  group_key: InstallationSerialGroup;
  value: string;
}

// ตารางลูกทุก list = full replace (array ที่ส่ง = สถานะใหม่ทั้งหมด ลำดับ = ลำดับแสดงผล)
export interface SaveInstallationReportPayload {
  customer_id: string;
  /** บังคับตอน PUT — savedAt ที่ได้จาก GET/POST/PUT ล่าสุด (ไม่ใช่ updatedAt ของรูป) */
  expected_saved_at?: string;
  head: InstallationReportHeadPayload;
  components: InstallationComponentPayload[];
  installer_rows: InstallationInstallerRowPayload[];
  dc_strings: InstallationDcStringPayload[];
  ac_phases: InstallationAcPhasePayload[];
  checks: InstallationCheckPayload[];
  serials: InstallationSerialPayload[];
}

// ---------- response ----------

export interface InstallationReportPhoto {
  id: string;
  /** signed URL อายุ 1 ชั่วโมง; เป็น '' ถ้าไฟล์ใน storage หาย */
  url: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface InstallationComponentItem {
  qty: string | null;
  name: string | null;
  detail: string | null;
}

export interface InstallationInstallerRow {
  section: string;
  component: string;
  description: string;
  inputType: InstallationInstallerInputType;
  value: string | null;
  checked: boolean;
}

export interface InstallationDcString {
  mppt: string | null;
  stringNo: string | null;
  panelsPerString: number | null;
  vocNominal: string | null;
  vdcReading: string | null;
  ampReading: string | null;
  readingTime: string | null;
}

export interface InstallationAcPhase {
  phase: string | null;
  ampReading: string | null;
  voltageReading: string | null;
}

export interface InstallationCheckItem {
  label: string;
  checked: boolean;
  value: string | null;
}

export interface InstallationReportDetail {
  id: string;
  customerId: string;

  customerName: string | null;
  address: string | null;
  /** 'YYYY-MM-DD' */
  completionDate: string | null;
  technician: string | null;
  weatherConditions: string | null;

  systemType: string | null;
  totalDcCapacity: string | null;
  acOutput: string | null;

  totalPvPanels: number | null;
  dcFuseSpecs: string | null;
  dcSurgeSpecs: string | null;
  dcInputWatts: string | null;
  acSurgeSpecs: string | null;
  totalAmps: string | null;
  technicianNotes: string | null;

  /** 'YYYY-MM-DD' */
  nextMaintenanceDate: string | null;

  arrayDetails: InstallationComponentItem[];
  powerStorageItems: InstallationComponentItem[];
  /** เรียงต่อกันทุก section — จัดกลุ่มตามตัวอักษร section เอง */
  installerRows: InstallationInstallerRow[];
  dcStrings: InstallationDcString[];
  acPhases: InstallationAcPhase[];
  commissioningChecklist: InstallationCheckItem[];
  permitChecklist: InstallationCheckItem[];
  backupLoadChecklist: InstallationCheckItem[];
  loadChecklist: InstallationCheckItem[];
  serials: Record<InstallationSerialGroup, string[]>;

  photosBySlot: Record<InstallationPhotoSlot, InstallationReportPhoto[]>;

  createdAt: string;
  createdBy: string | null;
  /** เปลี่ยนเมื่อ save หรือแก้รูป — ใช้โชว์ "แก้ล่าสุดโดย…" เท่านั้น */
  updatedAt: string;
  updatedBy: string | null;
  /** token สำหรับ expected_saved_at — เปลี่ยนเฉพาะตอน save ฟอร์ม */
  savedAt: string;
}

/** แถวเดียวใน History list ของลูกค้า */
export interface InstallationReportSummary {
  id: string;
  customerId: string;
  /** 'YYYY-MM-DD' */
  completionDate: string | null;
  technician: string | null;
  photoCount: number;
  createdAt: string;
  createdBy: string | null;
  // ใช้ซ่อนปุ่มลบของคนอื่นสำหรับ technician — null = แถวเก่าไม่มีเจ้าของ
  createdByUserId: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** ผลของการอัปโหลด/ลบรูป — ห้ามเอา updatedAt ไปใช้เป็น expected_saved_at */
export interface InstallationReportTouchResult {
  updatedAt: string;
  updatedBy: string | null;
}

export interface UploadInstallationReportPhotoResult extends InstallationReportTouchResult {
  photo: InstallationReportPhoto;
}
