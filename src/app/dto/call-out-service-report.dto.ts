// สัญญาระหว่าง frontend ↔ backend ของ Call Out Service Report (/call-out-service-reports)
// ชื่อ field ฝั่ง request เป็น snake_case ตรงกับ backend DTO, ฝั่ง response เป็น camelCase

export const CALL_OUT_PHOTO_SLOTS = ['preWork1', 'preWork2', 'postWork1', 'postWork2'] as const;
export type CallOutPhotoSlot = (typeof CALL_OUT_PHOTO_SLOTS)[number];

export type CallOutResolutionStatus = 'resolved' | 'monitoring' | 'unresolved';

// ---------- request ----------

// ทุก field ส่งเสมอ (ค่าว่าง = null) เพราะ PUT เป็น full replace
export interface CallOutServiceReportHeadPayload {
  customer_name: string | null;
  site_address: string | null;
  /** ISO timestamp (toISOString) */
  call_out_date_time: string | null;
  /** 'YYYY-MM-DD' (วันที่ตามเวลาท้องถิ่น ไม่ผ่าน toISOString เพราะ UTC อาจเลื่อนวัน) */
  resolution_date: string | null;
  system_size_type: string | null;
  inverter_model: string | null;
  reported_error_code: string | null;

  call_out_reason: string | null;
  inspection_findings: string | null;

  actions_taken: string | null;
  materials_used: string | null;
  result_status_note: string | null;
  resolution_status: CallOutResolutionStatus;

  engineer_name: string | null;
  /** 'YYYY-MM-DD' */
  engineer_sign_date: string | null;
  customer_sign_name: string | null;
  /** 'YYYY-MM-DD' */
  customer_sign_date: string | null;
}

export interface SaveCallOutServiceReportPayload {
  customer_id: string;
  /** บังคับตอน PUT — savedAt ที่ได้จาก GET/POST/PUT ล่าสุด (ไม่ใช่ updatedAt ของรูป) */
  expected_saved_at?: string;
  head: CallOutServiceReportHeadPayload;
}

// ---------- response ----------

export interface CallOutServiceReportPhoto {
  id: string;
  /** signed URL อายุ 1 ชั่วโมง; เป็น '' ถ้าไฟล์ใน storage หาย */
  url: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface CallOutServiceReportDetail {
  id: string;
  customerId: string;

  customerName: string | null;
  siteAddress: string | null;
  callOutDateTime: string | null;
  /** 'YYYY-MM-DD' */
  resolutionDate: string | null;
  systemSizeType: string | null;
  inverterModel: string | null;
  reportedErrorCode: string | null;

  callOutReason: string | null;
  inspectionFindings: string | null;

  actionsTaken: string | null;
  materialsUsed: string | null;
  resultStatusNote: string | null;
  resolutionStatus: CallOutResolutionStatus;

  engineerName: string | null;
  engineerSignDate: string | null;
  customerSignName: string | null;
  customerSignDate: string | null;

  photosBySlot: Record<CallOutPhotoSlot, CallOutServiceReportPhoto[]>;

  createdAt: string;
  createdBy: string | null;
  /** เปลี่ยนเมื่อ save หรือแก้รูป — ใช้โชว์ "แก้ล่าสุดโดย…" เท่านั้น */
  updatedAt: string;
  updatedBy: string | null;
  /** token สำหรับ expected_saved_at — เปลี่ยนเฉพาะตอน save ฟอร์ม */
  savedAt: string;
}

/** แถวเดียวใน History list ของลูกค้า */
export interface CallOutServiceReportSummary {
  id: string;
  customerId: string;
  callOutDateTime: string | null;
  resolutionStatus: CallOutResolutionStatus;
  reportedErrorCode: string | null;
  engineerName: string | null;
  photoCount: number;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** ผลของการอัปโหลด/ลบรูป — ห้ามเอา updatedAt ไปใช้เป็น expected_saved_at */
export interface CallOutServiceReportTouchResult {
  updatedAt: string;
  updatedBy: string | null;
}

export interface UploadCallOutServiceReportPhotoResult extends CallOutServiceReportTouchResult {
  photo: CallOutServiceReportPhoto;
}
