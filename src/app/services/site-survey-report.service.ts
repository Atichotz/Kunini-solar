import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  SaveSiteSurveyReportPayload,
  SiteSurveyPhotoTarget,
  SiteSurveyReportDetail,
  SiteSurveyReportSummary,
  SiteSurveyReportTouchResult,
  UploadSiteSurveyPhotoResult,
} from '../dto/site-survey-report.dto';

@Injectable({ providedIn: 'root' })
export class SiteSurveyReportService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/site-survey-reports`;

  // output: report ที่ยังไม่ถูกลบของลูกค้า ใหม่สุดก่อน — สำหรับ History
  listByCustomer(customerId: string): Observable<SiteSurveyReportSummary[]> {
    return this.http.get<SiteSurveyReportSummary[]>(this.baseUrl, { params: { customerId } });
  }

  // input: report UUID — output: report เต็ม + รูป (signed URL) + layout; 404 ถ้าไม่พบหรือถูกลบแล้ว
  getOne(id: string): Observable<SiteSurveyReportDetail> {
    return this.http.get<SiteSurveyReportDetail>(`${this.baseUrl}/${id}`);
  }

  // input: payload ไม่ต้องมี expected_saved_at — output: report ที่สร้างแล้ว (มี id จริงของ layout ให้แนบรูป sketch ต่อ)
  create(payload: SaveSiteSurveyReportPayload): Observable<SiteSurveyReportDetail> {
    return this.http.post<SiteSurveyReportDetail>(this.baseUrl, payload);
  }

  // input: report UUID + payload ที่ต้องมี expected_saved_at (full replace) — output: report หลังบันทึก
  // 409 = มีคนอื่น save ไปก่อน, 404 = report/layout ไม่พบ
  update(id: string, payload: SaveSiteSurveyReportPayload): Observable<SiteSurveyReportDetail> {
    return this.http.put<SiteSurveyReportDetail>(`${this.baseUrl}/${id}`, payload);
  }

  // input: report UUID — output: void (soft delete; ข้อมูลและไฟล์ยังอยู่ใน DB/storage)
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // input: report UUID (ต้อง save แล้ว), ไฟล์ และ slot หรือ (layoutOptionId + layoutPhotoKind) อย่างใดอย่างหนึ่ง
  // output: รูปที่อัปโหลด (signed URL) + updatedAt/updatedBy ใหม่ของ report
  uploadPhoto(reportId: string, file: File, target: SiteSurveyPhotoTarget): Observable<UploadSiteSurveyPhotoResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    if ('slot' in target) formData.append('slot', target.slot);
    else {
      formData.append('layoutOptionId', target.layoutOptionId);
      formData.append('layoutPhotoKind', target.layoutPhotoKind);
    }
    return this.http.post<UploadSiteSurveyPhotoResult>(`${this.baseUrl}/${reportId}/photos`, formData);
  }

  // input: report UUID + photo UUID — output: updatedAt/updatedBy ใหม่ (soft delete; ไฟล์ใน storage ยังอยู่)
  removePhoto(reportId: string, photoId: string): Observable<SiteSurveyReportTouchResult> {
    return this.http.delete<SiteSurveyReportTouchResult>(`${this.baseUrl}/${reportId}/photos/${photoId}`);
  }
}
