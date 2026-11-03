import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, filter, first, map, of, timeout } from 'rxjs';
import { AuthService, UserProfile } from '../services/auth.service';

// รอ GET /users/me เสร็จได้นานสุดเท่านี้ — เกินแล้วถือว่าไม่รู้ role
const PROFILE_WAIT_TIMEOUT_MS = 10_000;

// input: role ที่ห้ามเข้า route นี้ / output: guard ที่ส่ง role เหล่านั้นกลับ /workflow
// fail-closed: โหลด profile ไม่สำเร็จ/หมดเวลา ก็ส่งกลับ /workflow เหมือนกัน ไม่ปล่อยเข้าโดยไม่รู้ role
// ต้องวางใต้ route ที่มี authGuard แล้ว — guard นี้ไม่เช็ค session เอง
// สิทธิ์จริงบังคับที่ backend (@DenyRoles / @ReadOnlyRoles) guard นี้เป็นแค่ UX
export const denyRolesGuard = (...deniedRoles: UserProfile['role'][]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const redirectToWorkflow = router.createUrlTree(['/workflow']);

  return auth.currentProfile$.pipe(
    filter((profile) => profile !== null), // profile เป็น null ระหว่างรอ fetchProfile
    first(),
    timeout(PROFILE_WAIT_TIMEOUT_MS),
    map((profile) => (deniedRoles.includes(profile.role) ? redirectToWorkflow : true)),
    catchError(() => of(redirectToWorkflow)),
  );
};

// หน้าที่ technician เข้าไม่ได้ (ใช้ได้แค่ workflow, customer detail แบบอ่านอย่างเดียว, SOW และ Report) → ส่งกลับ /workflow
export const staffOnlyGuard: CanActivateFn = denyRolesGuard('technician');

// หน้าที่ทั้ง technician และ sales เข้าไม่ได้ — หน้าสร้าง/แก้ใบเสนอราคา และ Settings (มีราคาต้นทุนสินค้า)
// sales ดูใบเสนอราคาที่ final แล้วได้ผ่าน History card (/detail/:id/estimate/:estimateId ใช้ staffOnlyGuard)
export const noSalesGuard: CanActivateFn = denyRolesGuard('technician', 'sales');
