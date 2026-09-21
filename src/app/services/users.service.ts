import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UserListItem {
  userId: string;
  role: 'ceo' | 'purchasing' | 'admin' | 'technician';
  name: string;
  email: string;
  username: string | null;
  loginType: 'google' | 'username';
}

export interface CreateUserPayload {
  username: string;
  password: string;
  role: string;
  name: string;
}

export interface AddGoogleUserPayload {
  email: string;
  name: string;
  role: string;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  // output: UserListItem[] — ทุก user ในระบบ (ceo only)
  getUsers(): Observable<UserListItem[]> {
    return this.http.get<UserListItem[]>(`${this.api}/users`);
  }

  // input: userId, newPassword ที่ผ่าน validation แล้ว
  resetPassword(userId: string, newPassword: string): Observable<void> {
    return this.http.patch<void>(`${this.api}/users/${userId}/password`, { newPassword });
  }

  // input: userId, name ใหม่
  updateName(userId: string, name: string): Observable<void> {
    return this.http.patch<void>(`${this.api}/users/${userId}/name`, { name });
  }

  // input: userId, role ใหม่ — backend ปฏิเสธ (403) ถ้าเป้าหมายเป็น CEO อยู่แล้ว
  updateRole(userId: string, role: UserListItem['role']): Observable<void> {
    return this.http.patch<void>(`${this.api}/users/${userId}/role`, { role });
  }

  // input: userId — soft delete (ปิดบัญชี + ซ่อนจากรายชื่อ)
  // error: 409 ถ้ายังมีงาน To-Do ค้าง, 403 ถ้าเป็น CEO, 404 ถ้าไม่พบ
  deleteUser(userId: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/users/${userId}`);
  }

  // input: CreateUserPayload — สร้าง username user ใหม่ + insert allowed_users
  createUser(payload: CreateUserPayload): Observable<{ id: string; email: string; role: string }> {
    return this.http.post<{ id: string; email: string; role: string }>(
      `${this.api}/auth/create-user`,
      payload,
    );
  }

  // input: AddGoogleUserPayload — pre-authorize Google email ลง allowed_users (Supabase trigger จัดการ user_roles ตอน login)
  addGoogleUser(payload: AddGoogleUserPayload): Observable<void> {
    return this.http.post<void>(`${this.api}/auth/add-google-user`, payload);
  }
}
