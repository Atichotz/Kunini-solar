import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  CallOutPhotoSlot,
  CallOutServiceReportDetail,
  CallOutServiceReportSummary,
  CallOutServiceReportTouchResult,
  SaveCallOutServiceReportPayload,
  UploadCallOutServiceReportPhotoResult,
} from '../dto/call-out-service-report.dto';

@Injectable({ providedIn: 'root' })
export class CallOutServiceReportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/call-out-service-reports`;

  // output: report ที่ยังไม่ถูกลบของลูกค้า ใหม่สุดก่อน — สำหรับ History
  listByCustomer(customerId: string): Observable<CallOutServiceReportSummary[]> {
    return this.http.get<CallOutServiceReportSummary[]>(this.baseUrl, { params: { customerId } });
  }

  // input: report UUID — output: report เต็ม + รูป (signed URL); 404 ถ้าไม่พบหรือถูกลบแล้ว
  getOne(id: string): Observable<CallOutServiceReportDetail> {
    return this.http.get<CallOutServiceReportDetail>(`${this.baseUrl}/${id}`);
  }

  // input: payload ไม่ต้องมี expected_saved_at — output: report ที่สร้างแล้ว (มี id จริงให้อัปโหลดรูปต่อ)
  create(payload: SaveCallOutServiceReportPayload): Observable<CallOutServiceReportDetail> {
    return this.http.post<CallOutServiceReportDetail>(this.baseUrl, payload);
  }

  // input: report UUID + payload ที่ต้องมี expected_saved_at (full replace) — output: report หลังบันทึก
  // 409 = มีคนอื่น save ไปก่อน, 404 = report ไม่พบ
  update(id: string, payload: SaveCallOutServiceReportPayload): Observable<CallOutServiceReportDetail> {
    return this.http.put<CallOutServiceReportDetail>(`${this.baseUrl}/${id}`, payload);
  }

  // input: report UUID — output: void (soft delete; ข้อมูลและไฟล์ยังอยู่ใน DB/storage)
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // input: report UUID (ต้อง save แล้ว), ไฟล์ และ slot ของรูป
  // output: รูปที่อัปโหลด (signed URL) + updatedAt/updatedBy ใหม่ของ report
  uploadPhoto(reportId: string, file: File, slot: CallOutPhotoSlot): Observable<UploadCallOutServiceReportPhotoResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('slot', slot);
    return this.http.post<UploadCallOutServiceReportPhotoResult>(`${this.baseUrl}/${reportId}/photos`, formData);
  }

  // input: report UUID + photo UUID — output: updatedAt/updatedBy ใหม่ (soft delete; ไฟล์ใน storage ยังอยู่)
  removePhoto(reportId: string, photoId: string): Observable<CallOutServiceReportTouchResult> {
    return this.http.delete<CallOutServiceReportTouchResult>(`${this.baseUrl}/${reportId}/photos/${photoId}`);
  }
}
