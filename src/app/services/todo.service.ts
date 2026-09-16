import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { TodoCard, TodoAssignee, TodoCategory, CreateTodoPayload } from '../dto/todo.dto';

@Injectable({ providedIn: 'root' })
export class TodoService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/todos`;

  // input: category filter
  // output: todo ทั้งหมดในหมวดนั้น เรียงตาม is_done ASC, created_at ASC จาก backend แล้ว
  getAll(category: TodoCategory): Observable<TodoCard[]> {
    return this.http.get<TodoCard[]>(this.baseUrl, { params: { category } });
  }

  // output: รายชื่อ user ทั้งหมดสำหรับ dropdown มอบหมายงาน
  getAssignees(): Observable<TodoAssignee[]> {
    return this.http.get<TodoAssignee[]>(`${this.baseUrl}/assignees`);
  }

  // input: CreateTodoPayload
  // output: todo ที่สร้างแล้ว
  create(payload: CreateTodoPayload): Observable<TodoCard> {
    return this.http.post<TodoCard>(this.baseUrl, payload);
  }

  // input: todo UUID — สลับ is_done และ sync status ที่ backend
  toggle(id: string): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/${id}/toggle`, {});
  }

  // input: todo UUID
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
