import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly auth = inject(AuthService);

  private readonly profile = toSignal(this.auth.currentProfile$, { initialValue: null });

  // fail-closed: profile ยังโหลดไม่เสร็จ (null) ถือว่าไม่มีสิทธิ์ เพื่อไม่ให้ปุ่มแก้ไขแวบขึ้นมา
  // คืน true เฉพาะ role 'ceo' หรือ 'admin'
  readonly canManage = computed<boolean>(() => {
    const role = this.profile()?.role;
    return role === 'ceo' || role === 'admin';
  });

  // แยกจาก canManage เพราะ backend อนุญาตเฉพาะ CEO เปลี่ยน role (PATCH /users/:id/role)
  readonly isCeo = computed<boolean>(() => this.profile()?.role === 'ceo');
}
