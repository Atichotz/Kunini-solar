export interface StatusOption {
  id: number;
  status_name: string;
  sort_order: number | null;
}

export interface ContactDetail {
  id: string;
  firstname: string | null;
  lastname: string | null;
  tel: string | null;
  email: string | null;
  isPrimary: boolean;
}

export interface ElectricBillDetail {
  billName: string | null;
  billAmount: number | null;
  caRefNo: string | null;
  installationNo: string | null;
  electricityUsageType: string | null;
  kwhPerMonth: number | null;
  fileName: string | null;
  fileUrl: string | null;
}

export interface UpsertContactPayload {
  firstname: string;
  lastname?: string;
  tel?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface NoteDetail {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
  // backend คำนวณให้ (เจ้าของโน้ต หรือ ceo/admin) — ใช้ซ่อนปุ่มลบเท่านั้น สิทธิ์จริงบังคับที่ backend
  canDelete: boolean;
  commentCount: number;
}

export interface CreateNotePayload {
  text: string;
}

export interface NoteCommentImageDetail {
  id: string;
  url: string;
  name: string;
}

export interface NoteCommentDetail {
  id: string;
  noteId: string;
  text: string;
  createdAt: string;
  createdBy: string;
  canDelete: boolean;
  images: NoteCommentImageDetail[];
}

export interface UpdateCustomerNamePayload {
  displayName: string;
}

export interface UpdateCustomerNumberPayload {
  customerNumber: string | null;
}

export interface UpdateCustomerDetailsPayload {
  fullAddress: string;
  googleMapsLink: string | null;
  projectLocationName: string;
  typeOfCustomerName: string;
  typeOfSystemName: string;
}

export interface CustomerDetailsResult {
  fullAddress: string | null;
  googleMapsLink: string | null;
  projectLocationName: string | null;
  typeOfCustomerName: string | null;
  typeOfSystemName: string | null;
}

export interface SaveElectricBillPayload {
  billName?: string;
  billAmount?: number;
  caRefNo?: string;
  installationNo?: string;
  electricityUsageType?: string;
  kwhPerMonth?: number;
}

export interface CustomerDetail {
  id: string;
  displayName: string;
  customerNumber: string | null;
  projectLocationName: string | null;
  typeOfCustomerName: string | null;
  typeOfSystemName: string | null;
  statusId: number | null;
  createdAt: string;
  fullAddress: string | null;
  googleMapsLink: string | null;
  contacts: ContactDetail[];
  electricBill: ElectricBillDetail | null;
}

export interface CustomerListContact {
  firstname: string | null;
  lastname: string | null;
  tel: string | null;
  email: string | null;
}

export interface CustomerListItem {
  id: string;
  displayName: string;
  customerNumber: string | null;
  fullAddress: string | null;
  googleMapsLink: string | null;
  contact: CustomerListContact | null;
  projectLocationName: string | null;
  typeOfCustomerName: string | null;
  typeOfSystemName: string | null;
  statusId: number | null;
}

export interface CreateCustomerPayload {
  display_name: string;
  customer_number: string | null;
  project_type: string | null;
  project_location_name: string;
  type_of_customer_name: string;
  type_of_system_name: string;
  status_id: number | null;
  full_address: string | null;
  google_maps_link: string | null;
  contact: {
    firstname: string;
    lastname: string;
    tel: string;
    email: string;
  };
}
