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
  projectLocationName: string | null;
  typeOfCustomerName: string | null;
  typeOfSystemName: string | null;
  statusId: number | null;
  createdAt: string;
  contacts: ContactDetail[];
  electricBill: ElectricBillDetail | null;
}

export interface CreateCustomerPayload {
  display_name: string;
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
