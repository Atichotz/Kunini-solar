import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { TicketCard, TicketAssignee, CreateTicketPayload, UpdateTicketPayload, TicketComment, AddTicketCommentPayload } from '../dto/ticket.dto';

@Injectable({ providedIn: 'root' })
export class TicketService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tickets`;

  // output: ticket ที่ user เห็นได้ (backend กรองตามสิทธิ์แล้ว) เรียงตาม is_done ASC, created_at ASC
  //   ceo/admin ได้ทุก ticket, role อื่นได้ ticket ของทีม (role) เดียวกัน
  getAll(): Observable<TicketCard[]> {
    return this.http.get<TicketCard[]>(this.baseUrl);
  }

  // output: ตัวเองใน allowed_users (id/name/role)
  getMe(): Observable<TicketAssignee> {
    return this.http.get<TicketAssignee>(`${this.baseUrl}/me`);
  }

  // output: รายชื่อที่ user มอบ ticket ให้ได้ (ceo/admin ได้ทุกคน, role อื่นได้เฉพาะ role เดียวกัน)
  getAssignees(): Observable<TicketAssignee[]> {
    return this.http.get<TicketAssignee[]>(`${this.baseUrl}/assignees`);
  }

  // input: CreateTicketPayload (assignee_ids ต้องมีอย่างน้อย 1 คน)
  // output: ticket ที่สร้างแล้ว
  create(payload: CreateTicketPayload): Observable<TicketCard> {
    return this.http.post<TicketCard>(this.baseUrl, payload);
  }

  // input: ticket UUID — สลับ is_done และ sync status ที่ backend (เฉพาะ assignee/ceo/admin)
  toggle(id: string): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/${id}/toggle`, {});
  }

  // input: ticket UUID, field ที่จะแก้ (undefined = ไม่แตะ, null = ล้างค่า) — output: ticket ที่อัปเดตแล้ว (เฉพาะ assignee/ceo/admin)
  update(id: string, payload: UpdateTicketPayload): Observable<TicketCard> {
    return this.http.patch<TicketCard>(`${this.baseUrl}/${id}`, payload);
  }

  // input: ticket UUID (เฉพาะ assignee/ceo/admin)
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // output: comment ของ ticket นี้ เรียงเก่า→ใหม่ (เฉพาะคนที่มองเห็น ticket นี้ได้)
  getComments(ticketId: string): Observable<TicketComment[]> {
    return this.http.get<TicketComment[]>(`${this.baseUrl}/${ticketId}/comments`);
  }

  // input: ticket UUID, payload (ต้องมี body หรือ files อย่างน้อยอย่างใดอย่างหนึ่ง)
  // output: comment ที่สร้างแล้ว — ส่งเป็น multipart เพราะมีไฟล์แนบได้
  addComment(ticketId: string, payload: AddTicketCommentPayload): Observable<TicketComment> {
    const form = new FormData();
    if (payload.body) form.append('body', payload.body);
    if (payload.mentionedUserIds?.length) form.append('mentioned_user_ids', JSON.stringify(payload.mentionedUserIds));
    (payload.files ?? []).forEach(file => form.append('files', file));
    return this.http.post<TicketComment>(`${this.baseUrl}/${ticketId}/comments`, form);
  }

  // input: ticket UUID, comment UUID (เฉพาะเจ้าของ comment หรือ ceo/admin)
  deleteComment(ticketId: string, commentId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${ticketId}/comments/${commentId}`);
  }
}
