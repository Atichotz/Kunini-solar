import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { TodoCard, TodoAssignee, CreateTodoPayload, UpdateTodoPayload } from '../dto/todo.dto';

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
}
