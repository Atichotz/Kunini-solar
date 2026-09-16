// ===== payload ที่ส่งไป POST /estimates (snake_case ตรงกับ column ใน DB — ตาม convention เดิมของ CreateCustomerPayload) =====

export interface EstimateHeadPayload {
  customer_display_name: string | null;
  contact_reference: string | null;
  project_location_name: string | null;
  type_of_system_name: string | null;
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

export interface EstimateItemsPayload {
  panel: EstimatePanelItemPayload[];
  inverter: EstimateInverterItemPayload[];
  battery: EstimateBatteryItemPayload[];
  racking: EstimateRackingItemPayload[];
  bos: EstimateBosItemPayload[];
  labour: EstimateLabourItemPayload[];
}

export interface SaveEstimatePayload {
  customer_id: string;
  finalize: boolean;
  head: EstimateHeadPayload;
  items: EstimateItemsPayload;
}

export interface SaveEstimateResult {
  id: string;
  status: 'draft' | 'final';
  versionNo: number | null;
  updatedAt: string;
}

// ===== response จาก GET (camelCase ตรงกับ convention เดิมของ CustomerDetail) =====

export interface EstimateSummary {
  id: string;
  status: 'draft' | 'final';
  versionNo: number | null;
  grandTotal: number;
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

export interface EstimateDetail {
  id: string;
  customerId: string;
  status: 'draft' | 'final';
  versionNo: number | null;

  customerDisplayName: string | null;
  contactReference: string | null;
  projectLocationName: string | null;
  typeOfSystemName: string | null;

  totalKw: number;
  panelTotal: number;
  inverterTotal: number;
  batteryTotal: number;
  rackingTotal: number;
  bosTotal: number;
  installationTotal: number;
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
}
