import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  SaveSowPayload,
  SowDetail,
  SowSummary,
  SowTouchResult,
  UploadSowPhotoResult,
} from '../dto/sow.dto';

@Injectable({ providedIn: 'root' })
export class SowService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/sows`;

  // output: SOW ที่ยังไม่ถูกลบของลูกค้า ใหม่สุดก่อน — สำหรับ History
  listByCustomer(customerId: string): Observable<SowSummary[]> {
    return this.http.get<SowSummary[]>(this.baseUrl, { params: { customerId } });
  }

  // input: SOW UUID — output: SOW เต็ม + days/tasks + EOD reports + รูป (signed URL); 404 ถ้าไม่พบหรือถูกลบแล้ว
  getOne(id: string): Observable<SowDetail> {
    return this.http.get<SowDetail>(`${this.baseUrl}/${id}`);
  }

  // input: payload ไม่ต้องมี expected_saved_at — output: SOW ที่สร้างแล้ว (มี id จริงของ day/task/EOD ให้แนบรูปต่อ)
  create(payload: SaveSowPayload): Observable<SowDetail> {
    return this.http.post<SowDetail>(this.baseUrl, payload);
  }

  // input: SOW UUID + payload ที่ต้องมี expected_saved_at (full replace) — output: SOW หลังบันทึก
  // 409 = มีคนอื่น save ไปก่อน, 404 = SOW/day/task/EOD ไม่พบ, 400 = ข้อมูลไม่ถูกต้อง
  update(id: string, payload: SaveSowPayload): Observable<SowDetail> {
    return this.http.put<SowDetail>(`${this.baseUrl}/${id}`, payload);
  }

  // input: SOW UUID — output: void (soft delete; ข้อมูลและไฟล์ยังอยู่ใน DB/storage)
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // input: SOW UUID + EOD report UUID (ต้อง save แล้ว) + ไฟล์ — output: รูปที่อัปโหลด (signed URL) + updatedAt/updatedBy ใหม่
  uploadPhoto(sowId: string, reportId: string, file: File): Observable<UploadSowPhotoResult> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<UploadSowPhotoResult>(`${this.baseUrl}/${sowId}/eod-reports/${reportId}/photos`, formData);
  }

  // input: SOW UUID + EOD report UUID + photo UUID — output: updatedAt/updatedBy ใหม่ (soft delete; ไฟล์ใน storage ยังอยู่)
  removePhoto(sowId: string, reportId: string, photoId: string): Observable<SowTouchResult> {
    return this.http.delete<SowTouchResult>(`${this.baseUrl}/${sowId}/eod-reports/${reportId}/photos/${photoId}`);
  }
}
