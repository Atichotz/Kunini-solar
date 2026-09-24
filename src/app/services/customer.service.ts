import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  StatusOption,
  CreateCustomerPayload,
  CustomerDetail,
  ContactDetail,
  CreateNotePayload,
  NoteDetail,
  UpdateCustomerNamePayload,
  UpdateCustomerNumberPayload,
  UpdateCustomerDetailsPayload,
  CustomerDetailsResult,
  UpsertContactPayload,
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

  // input: customer UUID, status id ใหม่ — output: void (backend ตอบ 200 ไม่มี body)
  updateStatus(customerId: string, statusId: number): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/${customerId}/status`, { statusId });
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

  // input: customer UUID + contact fields ใหม่ (created_by แนบโดย backend จาก JWT)
  // output: contact ที่สร้างแล้ว
  addContact(customerId: string, payload: UpsertContactPayload): Observable<ContactDetail> {
    return this.http.post<ContactDetail>(`${this.baseUrl}/${customerId}/contacts`, payload);
  }

  // input: customer UUID + contact UUID + fields ที่แก้ไข
  // output: contact ที่อัปเดตแล้ว
  updateContact(customerId: string, contactId: string, payload: UpsertContactPayload): Observable<ContactDetail> {
    return this.http.patch<ContactDetail>(`${this.baseUrl}/${customerId}/contacts/${contactId}`, payload);
  }

  // input: customer UUID + contact UUID
  // output: void — backend จะปฏิเสธถ้าเป็น contact สุดท้ายที่เหลืออยู่
  deleteContact(customerId: string, contactId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${customerId}/contacts/${contactId}`);
  }

  // input: customer UUID + ชื่อใหม่
  // output: ชื่อที่ backend บันทึกแล้ว (trim แล้ว)
  updateName(customerId: string, payload: UpdateCustomerNamePayload): Observable<{ displayName: string }> {
    return this.http.patch<{ displayName: string }>(`${this.baseUrl}/${customerId}`, payload);
  }

  // input: customer UUID + customer number ใหม่ (null = ล้างค่า)
  // output: ค่าที่ backend บันทึกแล้ว (trim แล้ว), 409 ถ้าเลขซ้ำกับลูกค้าคนอื่น
  updateCustomerNumber(customerId: string, payload: UpdateCustomerNumberPayload): Observable<{ customerNumber: string | null }> {
    return this.http.patch<{ customerNumber: string | null }>(`${this.baseUrl}/${customerId}/customer-number`, payload);
  }

  // input: customer UUID + ที่อยู่/ลิงก์แผนที่/location/project type/system type
  // output: ค่าที่ backend บันทึกแล้ว (link ว่างถูกแปลงเป็น null)
  updateDetails(customerId: string, payload: UpdateCustomerDetailsPayload): Observable<CustomerDetailsResult> {
    return this.http.patch<CustomerDetailsResult>(`${this.baseUrl}/${customerId}/details`, payload);
  }

  // input: customer UUID
  // output: โน้ตของลูกค้า เรียงใหม่สุดก่อน (แต่ละโน้ตมี canDelete ตามสิทธิ์ของ user ปัจจุบัน)
  listNotes(customerId: string): Observable<NoteDetail[]> {
    return this.http.get<NoteDetail[]>(`${this.baseUrl}/${customerId}/notes`);
  }

  // input: customer UUID + ข้อความโน้ต (author แนบโดย backend จาก JWT)
  // output: โน้ตที่สร้างแล้ว
  addNote(customerId: string, payload: CreateNotePayload): Observable<NoteDetail> {
    return this.http.post<NoteDetail>(`${this.baseUrl}/${customerId}/notes`, payload);
  }

  // input: customer UUID + note UUID
  // output: void — 403 ถ้าไม่ใช่เจ้าของ/admin/ceo, 404 ถ้าถูกลบไปแล้ว
  deleteNote(customerId: string, noteId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${customerId}/notes/${noteId}`);
  }
}
