import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { TodoCard, TodoAssignee, CreateTodoPayload, UpdateTodoPayload, TodoComment, AddTodoCommentPayload } from '../dto/todo.dto';

@Injectable({ providedIn: 'root' })
export class TodoService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/todos`;

  // output: todo ที่ user เห็นได้ (backend กรองตามสิทธิ์แล้ว) เรียงตาม is_done ASC, created_at ASC
  //   ceo/admin ได้ทุกงาน, role อื่นได้งานของทีม (role) เดียวกัน
  getAll(): Observable<TodoCard[]> {
    return this.http.get<TodoCard[]>(this.baseUrl);
  }

  // output: ตัวเองใน allowed_users (id/name/role) — role ตรงนี้ใช้ตัดสินว่าแสดง 1 หรือ 2 การ์ด
  getMe(): Observable<TodoAssignee> {
    return this.http.get<TodoAssignee>(`${this.baseUrl}/me`);
  }

  // output: รายชื่อที่ user มอบงานให้ได้ (ceo/admin ได้ทุกคน, role อื่นได้เฉพาะ role เดียวกัน)
  getAssignees(): Observable<TodoAssignee[]> {
    return this.http.get<TodoAssignee[]>(`${this.baseUrl}/assignees`);
  }

  // input: CreateTodoPayload (assignee_ids ต้องมีอย่างน้อย 1 คน)
  // output: todo ที่สร้างแล้ว
  create(payload: CreateTodoPayload): Observable<TodoCard> {
    return this.http.post<TodoCard>(this.baseUrl, payload);
  }

  // input: todo UUID — สลับ is_done และ sync status ที่ backend (เฉพาะ assignee/ceo/admin)
  toggle(id: string): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/${id}/toggle`, {});
  }

  // input: todo UUID, field ที่จะแก้ (undefined = ไม่แตะ, null = ล้างค่า) — output: todo ที่อัปเดตแล้ว (เฉพาะ assignee/ceo/admin)
  update(id: string, payload: UpdateTodoPayload): Observable<TodoCard> {
    return this.http.patch<TodoCard>(`${this.baseUrl}/${id}`, payload);
  }

  // input: todo UUID (เฉพาะ assignee/ceo/admin)
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  // output: comment ของ task นี้ เรียงเก่า→ใหม่ (เฉพาะคนที่มองเห็น task นี้ได้)
  getComments(todoId: string): Observable<TodoComment[]> {
    return this.http.get<TodoComment[]>(`${this.baseUrl}/${todoId}/comments`);
  }

  // input: todo UUID, payload (ต้องมี body หรือ files อย่างน้อยอย่างใดอย่างหนึ่ง)
  // output: comment ที่สร้างแล้ว — ส่งเป็น multipart เพราะมีไฟล์แนบได้
  addComment(todoId: string, payload: AddTodoCommentPayload): Observable<TodoComment> {
    const form = new FormData();
    if (payload.body) form.append('body', payload.body);
    if (payload.mentionedUserIds?.length) form.append('mentioned_user_ids', JSON.stringify(payload.mentionedUserIds));
    (payload.files ?? []).forEach(file => form.append('files', file));
    return this.http.post<TodoComment>(`${this.baseUrl}/${todoId}/comments`, form);
  }

  // input: todo UUID, comment UUID (เฉพาะเจ้าของ comment หรือ ceo/admin)
  deleteComment(todoId: string, commentId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${todoId}/comments/${commentId}`);
  }
}
