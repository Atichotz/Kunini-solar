import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  StatusOption,
  CreateCustomerPayload,
  CustomerDetail,
  ElectricBillDetail,
  SaveElectricBillPayload,
} from '../dto/customer.dto';

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/customers`;

  // output: รายการ status ทั้งหมดจาก DB
  getStatuses(): Observable<StatusOption[]> {
    return this.http.get<StatusOption[]>(`${this.baseUrl}/statuses`);
  }

  // input: customer UUID
  // output: customer detail พร้อม contacts
  getOne(id: string): Observable<CustomerDetail> {
    return this.http.get<CustomerDetail>(`${this.baseUrl}/${id}`);
  }

  // input: CreateCustomerPayload (created_by แนบโดย backend จาก JWT)
  // output: { customer, contact } ที่ backend สร้างแล้ว
  create(payload: CreateCustomerPayload): Observable<unknown> {
    return this.http.post(this.baseUrl, payload);
  }

  // input: customer UUID + form fields ของ electric bill
  // output: electric bill ที่บันทึกแล้ว พร้อม signed URL ของไฟล์แนบ (ถ้ามี)
  saveElectricBill(customerId: string, payload: SaveElectricBillPayload): Observable<ElectricBillDetail> {
    return this.http.put<ElectricBillDetail>(`${this.baseUrl}/${customerId}/electric-bill`, payload);
  }

  // input: customer UUID + ไฟล์บิลไฟฟ้า (PDF/JPEG/PNG)
  // output: electric bill ที่อัปเดตแล้ว พร้อม signed URL ของไฟล์ใหม่
  uploadElectricBillFile(customerId: string, file: File): Observable<ElectricBillDetail> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<ElectricBillDetail>(`${this.baseUrl}/${customerId}/electric-bill/file`, formData);
  }

  // input: customer UUID
  // output: void — ลบไฟล์บิลไฟฟ้าที่แนบไว้ทิ้ง
  deleteElectricBillFile(customerId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${customerId}/electric-bill/file`);
  }
}
