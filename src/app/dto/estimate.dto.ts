// ===== payload ที่ส่งไป POST /estimates (snake_case ตรงกับ column ใน DB — ตาม convention เดิมของ CreateCustomerPayload) =====

export interface EstimateHeadPayload {
  customer_display_name: string | null;
  contact_reference: string | null;
  project_location_name: string | null;
  project_google_maps_link: string | null;
  type_of_system_name: string | null;
  pdf_remarks: string | null;
  sales_rep_name: string | null;
  /** จำนวนวันที่ใบเสนอราคายังมีผล (1–365) */
  validity_days: number;
}

export interface EstimatePanelItemPayload {
  item_role: 'main' | 'accessory';
  source_table: string | null;
  source_id: number | null;
  brand: string;
  description: string;
  kw: number;
  cost_price: number;
  sale_price: number;
  quantity: number;
  sort_order: number;
}

export interface EstimateInverterItemPayload extends EstimatePanelItemPayload {
  phase: string;
}

export type EstimateBatteryItemPayload = EstimatePanelItemPayload;

export interface EstimateRackingItemPayload {
  source_table: string | null;
  source_id: number | null;
  roof_type_id: number | null;
  roof_type_name: string;
  part: string;
  description: string;
  cost_price: number;
  sale_price: number;
  quantity: number;
  sort_order: number;
}

export interface EstimateBosItemPayload {
  category: 'cables' | 'switch_gears' | 'solar_equipment' | 'conduit_junction_boxes' | 'accessories';
  source_table: string | null;
  source_id: number | null;
  item: string;
  description: string;
  size: string;
  cost_price: number;
  sale_price: number;
  quantity: number;
  sort_order: number;
}

export interface EstimateLabourItemPayload {
  category: 'in_house' | 'outsourced' | 'machinery';
  description: string;
  unit_rate: number;
  units: number;
  sort_order: number;
}

// snapshot ชื่อ + rate ของ documentation type ณ วันที่ save
export interface EstimateDocumentationItemPayload {
  source_table: string | null;
  source_id: number | null;
  documentation_type_name: string;
  unit_rate: number;
  quantity: number;
  sort_order: number;
}

export interface EstimateItemsPayload {
  panel: EstimatePanelItemPayload[];
  inverter: EstimateInverterItemPayload[];
  battery: EstimateBatteryItemPayload[];
  racking: EstimateRackingItemPayload[];
  bos: EstimateBosItemPayload[];
  labour: EstimateLabourItemPayload[];
  documentation: EstimateDocumentationItemPayload[];
}

export interface SaveEstimatePayload {
  customer_id: string;
  // มีค่า = แก้ draft เดิมของ id นี้, null = สร้าง draft ใหม่
  estimate_id: string | null;
  // มีค่าเฉพาะตอนกด Create Revision จากใบ final เดิม (คู่กับ estimate_id: null เสมอ) — null ปกติ
  revised_from_id: string | null;
  head: EstimateHeadPayload;
  items: EstimateItemsPayload;
}

export interface SaveEstimateResult {
  id: string;
  status: 'draft' | 'final';
  versionNo: number | null;
  updatedAt: string;
}

export interface FinalizeEstimateResult extends SaveEstimateResult {
  quotationNo: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
}

// ===== response จาก GET (camelCase ตรงกับ convention เดิมของ CustomerDetail) =====

export interface EstimateSummary {
  id: string;
  status: 'draft' | 'final';
  versionNo: number | null;
  // เลขที่ใบเสนอราคา ฟอร์แมต QT-YYYY-#### — null จนกว่าจะ finalize; History list โชว์เลขนี้แทน "v{versionNo}"
  quotationNo: string | null;
  // มีค่า = ใบนี้เป็น revision ของใบ final อื่น — ใช้เช็คว่ามี draft revision ค้างอยู่หรือยัง (ปุ่ม Create Revision, badge "Draft REV")
  revisedFromId: string | null;
  // มีค่า = ใบ final นี้ถูก revision อื่นแทนที่แล้ว — โชว์ badge "Superseded" แทน "Final" และไม่นับใน currentSystem
  supersededById: string | null;
  // null = backend ซ่อนราคาตาม role (technician)
  grandTotal: number | null;
  totalKw: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
}

export interface EstimatePanelItemView {
  itemRole: 'main' | 'accessory';
  sourceTable: string | null;
  sourceId: number | null;
  brand: string;
  description: string;
  kw: number;
  costPrice: number;
  salePrice: number;
  quantity: number;
  total: number;
}

export interface EstimateInverterItemView extends EstimatePanelItemView {
  phase: string;
}

export type EstimateBatteryItemView = EstimatePanelItemView;

export interface EstimateRackingItemView {
  sourceTable: string | null;
  sourceId: number | null;
  roofTypeId: number | null;
  roofTypeName: string;
  part: string;
  description: string;
  costPrice: number;
  salePrice: number;
  quantity: number;
  total: number;
}

export interface EstimateBosItemView {
  category: string;
  sourceTable: string | null;
  sourceId: number | null;
  item: string;
  description: string;
  size: string;
  costPrice: number;
  salePrice: number;
  quantity: number;
  total: number;
}

export interface EstimateLabourItemView {
  category: string;
  description: string;
  unitRate: number;
  units: number;
  total: number;
}

export interface EstimateDocumentationItemView {
  sourceTable: string | null;
  sourceId: number | null;
  documentationTypeName: string;
  unitRate: number;
  quantity: number;
  total: number;
}

export interface EstimateDetail {
  id: string;
  customerId: string;
  status: 'draft' | 'final';
  versionNo: number | null;
  /** เลขที่ใบเสนอราคา รันต่อเนื่องทั้งบริษัท ฟอร์แมต QT-YYYY-#### — null จนกว่าจะ finalize */
  quotationNo: string | null;
  /** มีค่า = ใบนี้เป็น revision ที่สร้างมาจากใบ final อื่น (ปุ่ม Create Revision) */
  revisedFromId: string | null;
  /** มีค่า = ใบ final นี้ถูก revision อื่นแทนที่แล้ว — ห้าม unfinalize ตรงๆ, ไม่นับใน currentSystem */
  supersededById: string | null;

  customerDisplayName: string | null;
  contactReference: string | null;
  projectLocationName: string | null;
  projectGoogleMapsLink: string | null;
  typeOfSystemName: string | null;
  /** หมายเหตุสำหรับ PDF (1 บรรทัด = 1 ข้อ) — null = estimate เก่า/ไม่ได้กรอก */
  pdfRemarks: string | null;
  /** ชื่อ Sales Rep ที่ผู้ใช้กรอก — null = estimate เก่า/ไม่ได้กรอก */
  salesRepName: string | null;
  /** จำนวนวันที่ใบเสนอราคายังมีผล — estimate เก่าได้ 7 จาก default ของ DB */
  validityDays: number;

  totalKw: number;
  panelTotal: number;
  inverterTotal: number;
  batteryTotal: number;
  rackingTotal: number;
  bosTotal: number;
  installationTotal: number;
  documentationTotal: number;
  grandTotal: number;

  createdBy: string | null;
  createdByCtz: string | null;
  finalizedBy: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;

  panelItems: EstimatePanelItemView[];
  inverterItems: EstimateInverterItemView[];
  batteryItems: EstimateBatteryItemView[];
  rackingItems: EstimateRackingItemView[];
  bosItems: EstimateBosItemView[];
  labourItems: EstimateLabourItemView[];
  documentationItems: EstimateDocumentationItemView[];
}
