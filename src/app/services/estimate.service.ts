import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  EstimateDetail,
  EstimateSummary,
  FinalizeEstimateResult,
  SaveEstimatePayload,
  SaveEstimateResult,
} from '../dto/estimate.dto';

@Injectable({ providedIn: 'root' })
export class EstimateService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/estimates`;

  // input: payload snapshot ของทุก section (draft เสมอ — finalize แยกไปเรียก finalize() ต่างหาก)
  // output: { id, status, versionNo, updatedAt } ของ draft ที่เพิ่ง save
  save(payload: SaveEstimatePayload): Observable<SaveEstimateResult> {
    return this.http.post<SaveEstimateResult>(this.baseUrl, payload);
  }

  // input: estimate UUID ของ draft — output: estimate ที่ finalize แล้ว, throw ถ้าไม่ใช่ draft หรือไม่มีสิทธิ์
  finalize(id: string): Observable<FinalizeEstimateResult> {
    return this.http.patch<FinalizeEstimateResult>(`${this.baseUrl}/${id}/finalize`, {});
  }

  // input: estimate UUID ของใบที่ finalize แล้ว — output: estimate ที่ย้อนกลับเป็น draft, throw ถ้าไม่ใช่ ceo หรือยังไม่ final
  unfinalize(id: string): Observable<FinalizeEstimateResult> {
    return this.http.patch<FinalizeEstimateResult>(`${this.baseUrl}/${id}/unfinalize`, {});
  }

  // output: estimate ทั้งหมดของลูกค้า (draft + final) ใหม่สุดก่อน — สำหรับ History list
  listByCustomer(customerId: string): Observable<EstimateSummary[]> {
    return this.http.get<EstimateSummary[]>(this.baseUrl, { params: { customerId } });
  }

  // input: estimate UUID
  // output: HEAD + ลูกทั้ง 6 section
  getOne(id: string): Observable<EstimateDetail> {
    return this.http.get<EstimateDetail>(`${this.baseUrl}/${id}`);
  }

  // input: estimate UUID ของ draft (รวม draft ที่เป็น revision ค้างอยู่ด้วย) — output: void, throw ถ้าเป็น final แล้วหรือไม่มีสิทธิ์
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
