import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type {
  EstimateDetail,
  EstimateSummary,
  SaveEstimatePayload,
  SaveEstimateResult,
} from '../dto/estimate.dto';

@Injectable({ providedIn: 'root' })
export class EstimateService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/estimates`;

  // input: payload snapshot ของทุก section + finalize flag
  // output: { id, status, versionNo, updatedAt } ของ estimate ที่เพิ่ง save
  save(payload: SaveEstimatePayload): Observable<SaveEstimateResult> {
    return this.http.post<SaveEstimateResult>(this.baseUrl, payload);
  }

  // output: estimate ทั้งหมดของลูกค้า (draft + final) ใหม่สุดก่อน — สำหรับ History list
  listByCustomer(customerId: string): Observable<EstimateSummary[]> {
    return this.http.get<EstimateSummary[]>(this.baseUrl, { params: { customerId } });
  }

  // output: draft ที่ค้างอยู่ของลูกค้า หรือ null ถ้าไม่มี
  getDraft(customerId: string): Observable<EstimateDetail | null> {
    return this.http.get<EstimateDetail | null>(`${this.baseUrl}/draft`, { params: { customerId } });
  }

  // input: estimate UUID
  // output: HEAD + ลูกทั้ง 6 section
  getOne(id: string): Observable<EstimateDetail> {
    return this.http.get<EstimateDetail>(`${this.baseUrl}/${id}`);
  }
}
