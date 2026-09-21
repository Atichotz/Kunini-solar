import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { SurveyDetail, SurveyHistoryItem } from '../dto/survey.dto';

// ⚠️ endpoint เหล่านี้ยังไม่มีจริงที่ kunini-solar-backend — เขียนไว้ก่อนตามโครง service อื่นในโปรเจกต์
// (customer.service.ts / estimate.service.ts) เพื่อให้ frontend พร้อมต่อทันทีที่ backend สร้างให้
@Injectable({ providedIn: 'root' })
export class SurveyService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/surveys`;

  // output: survey ทั้งหมดของลูกค้า ใหม่สุดก่อน — สำหรับ Survey History list
  listByCustomer(customerId: string): Observable<SurveyHistoryItem[]> {
    return this.http.get<SurveyHistoryItem[]>(this.baseUrl, { params: { customerId } });
  }

  // input: survey UUID
  // output: survey เต็ม พร้อม photos + notes ทั้งหมด
  getOne(id: string): Observable<SurveyDetail> {
    return this.http.get<SurveyDetail>(`${this.baseUrl}/${id}`);
  }

  // input: customerId เสมอ, surveyId = null ถ้ายังไม่เคยมี record ของ survey นี้ (backend จะสร้างใหม่ให้แล้วคืน id กลับมาใน response)
  // output: survey ล่าสุดหลังแนบรูป (createdAt ถูกเซ็ตตอนนี้ถ้าเป็นรูปแรกของ survey ใหม่)
  addPhoto(customerId: string, surveyId: string | null, file: File): Observable<SurveyDetail> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('customerId', customerId);
    if (surveyId) formData.append('surveyId', surveyId);
    return this.http.post<SurveyDetail>(`${this.baseUrl}/photos`, formData);
  }

  // input: survey UUID + photo UUID
  removePhoto(surveyId: string, photoId: string): Observable<SurveyDetail> {
    return this.http.delete<SurveyDetail>(`${this.baseUrl}/${surveyId}/photos/${photoId}`);
  }

  // input: customerId เสมอ, surveyId = null ถ้ายังไม่เคยมี record ของ survey นี้ (เหมือน addPhoto)
  addNote(customerId: string, surveyId: string | null, text: string): Observable<SurveyDetail> {
    return this.http.post<SurveyDetail>(`${this.baseUrl}/notes`, { customerId, surveyId, text });
  }

  // input: survey UUID + note UUID + ข้อความใหม่
  updateNote(surveyId: string, noteId: string, text: string): Observable<SurveyDetail> {
    return this.http.patch<SurveyDetail>(`${this.baseUrl}/${surveyId}/notes/${noteId}`, { text });
  }

  // input: survey UUID + note UUID
  removeNote(surveyId: string, noteId: string): Observable<SurveyDetail> {
    return this.http.delete<SurveyDetail>(`${this.baseUrl}/${surveyId}/notes/${noteId}`);
  }
}
