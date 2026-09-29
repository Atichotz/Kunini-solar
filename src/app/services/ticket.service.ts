import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { TicketCard, TicketAssignee, CreateTicketPayload, UpdateTicketPayload, TicketComment, AddTicketCommentPayload, TicketAttachment } from '../dto/ticket.dto';

@Injectable({ providedIn: 'root' })
export class TicketService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tickets`;

  // output: ticket ที่ user เห็นได้ (backend กรองตามสิทธิ์แล้ว) เรียงตาม is_done ASC, created_at ASC
  //   ceo/admin ได้ทุก ticket, role อื่นได้ ticket ของทีม (role) เดียวกัน
  // input: customerId — ส่งมาแล้วได้ทุก ticket ของลูกค้ารายนั้นโดยไม่กรองทีม (หน้า customer detail ดูประวัติได้ทุก role)
  getAll(customerId?: string): Observable<TicketCard[]> {
    const params = customerId ? new HttpParams().set('customerId', customerId) : undefined;
    return this.http.get<TicketCard[]>(this.baseUrl, { params });
  }

  // output: ตัวเองใน allowed_users (id/name/role)
  getMe(): Observable<TicketAssignee> {
    return this.http.get<TicketAssignee>(`${this.baseUrl}/me`);
  }

  // output: รายชื่อที่ user มอบ ticket ให้ได้ (ทุก role มอบให้ใครก็ได้ในระบบ — แต่ role ที่ไม่ใช่ ceo/admin จะมองเห็นเฉพาะงานที่มี assignee role เดียวกับตัวเอง)
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

  // output: ไฟล์แนบของ ticket เอง (แนบตอน Add) พร้อม signed URL — เฉพาะคนที่มองเห็น ticket นี้ได้ (URL หมดอายุใน 1 ชม.)
  getAttachments(ticketId: string): Observable<TicketAttachment[]> {
    return this.http.get<TicketAttachment[]>(`${this.baseUrl}/${ticketId}/attachments`);
  }

  // input: ticket UUID, ไฟล์ (1-3 ไฟล์) — ส่งเป็น multipart, ผู้สร้างแนบได้แม้ไม่เห็น ticket ในลิสต์
  // output: ไฟล์แนบทั้งหมดของ ticket หลังเพิ่ม
  addAttachments(ticketId: string, files: File[]): Observable<TicketAttachment[]> {
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    return this.http.post<TicketAttachment[]>(`${this.baseUrl}/${ticketId}/attachments`, form);
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
