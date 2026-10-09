import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  InstallationPhotoSlot,
  InstallationReportDetail,
  InstallationReportSummary,
  InstallationReportTouchResult,
  SaveInstallationReportPayload,
  UploadInstallationReportPhotoResult,
} from '../dto/installation-report.dto';

@Injectable({ providedIn: 'root' })
export class InstallationReportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/installation-reports`;

  // output: report ที่ยังไม่ถูกลบของลูกค้า ใหม่สุดก่อน — สำหรับ History
  listByCustomer(customerId: string): Observable<InstallationReportSummary[]> {
    return this.http.get<InstallationReportSummary[]>(this.baseUrl, { params: { customerId } });
  }

  // input: report UUID — output: report เต็ม + ตารางลูกทุก list + รูป (signed URL); 404 ถ้าไม่พบหรือถูกลบแล้ว
  getOne(id: string): Observable<InstallationReportDetail> {
    return this.http.get<InstallationReportDetail>(`${this.baseUrl}/${id}`);
  }

  // input: payload ไม่ต้องมี expected_saved_at — output: report ที่สร้างแล้ว
  create(payload: SaveInstallationReportPayload): Observable<InstallationReportDetail> {
    return this.http.post<InstallationReportDetail>(this.baseUrl, payload);
  }

  // input: report UUID + payload ที่ต้องมี expected_saved_at (full replace) — output: report หลังบันทึก
  // 409 = มีคนอื่น save ไปก่อน, 404 = report ไม่พบ
  update(id: string, payload: SaveInstallationReportPayload): Observable<InstallationReportDetail> {
    return this.http.put<InstallationReportDetail>(`${this.baseUrl}/${id}`, payload);
  }

  // input: report UUID — output: void (soft delete; ข้อมูลและไฟล์ยังอยู่ใน DB/storage)
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // input: report UUID (ต้อง save แล้ว), ไฟล์ และ slot — output: รูปที่อัปโหลด (signed URL) + updatedAt/updatedBy ใหม่ของ report
  uploadPhoto(reportId: string, file: File, slot: InstallationPhotoSlot): Observable<UploadInstallationReportPhotoResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('slot', slot);
    return this.http.post<UploadInstallationReportPhotoResult>(`${this.baseUrl}/${reportId}/photos`, formData);
  }

  // input: report UUID + photo UUID — output: updatedAt/updatedBy ใหม่ (soft delete; ไฟล์ใน storage ยังอยู่)
  removePhoto(reportId: string, photoId: string): Observable<InstallationReportTouchResult> {
    return this.http.delete<InstallationReportTouchResult>(`${this.baseUrl}/${reportId}/photos/${photoId}`);
  }
}
