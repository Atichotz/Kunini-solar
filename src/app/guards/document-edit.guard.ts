import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, filter, first, map, of, timeout } from 'rxjs';
import { AuthService, UserProfile } from '../services/auth.service';

// รอ GET /users/me เสร็จได้นานสุดเท่านี้ — เกินแล้วถือว่าไม่รู้ role
const PROFILE_WAIT_TIMEOUT_MS = 10_000;

// role ที่ดู SOW/Report ได้อย่างเดียว (ตรงกับ @ReadOnlyRoles ที่ backend)
const READ_ONLY_DOCUMENT_ROLES: readonly UserProfile['role'][] = ['purchasing', 'sales'];

// หน้า SOW/Report ที่ purchasing และ sales ดูได้อย่างเดียว — เข้าได้เฉพาะตอนเปิดเอกสารที่มีอยู่แล้ว ห้ามเข้าเพื่อสร้างใหม่
// input: existingIdQueryParam = ชื่อ query param ที่บอกว่าเปิดของเดิม (เช่น 'sowId', 'reportId')
//        ไม่ส่ง = หน้านี้ไม่มีของเดิมให้ดู purchasing/sales เข้าไม่ได้เลย
// output: true = ผ่าน, UrlTree = ส่ง purchasing/sales กลับหน้า customer detail (ถ้ามี customerId) หรือ /workflow
// fail-closed: โหลด profile ไม่สำเร็จ/หมดเวลา ก็ส่งกลับเหมือนกัน
// สิทธิ์จริงบังคับที่ backend (@ReadOnlyRoles('purchasing', 'sales')) guard นี้เป็นแค่ UX
export const documentEditGuard = (existingIdQueryParam?: string): CanActivateFn => (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const customerId = route.queryParamMap.get('customerId');
  const redirectTarget = router.createUrlTree(customerId ? ['/detail', customerId] : ['/workflow']);
  const isOpeningExisting = existingIdQueryParam ? !!route.queryParamMap.get(existingIdQueryParam) : false;

  return auth.currentProfile$.pipe(
    filter((profile) => profile !== null), // profile เป็น null ระหว่างรอ fetchProfile
    first(),
    timeout(PROFILE_WAIT_TIMEOUT_MS),
    map((profile) => (READ_ONLY_DOCUMENT_ROLES.includes(profile.role) && !isOpeningExisting ? redirectTarget : true)),
    catchError(() => of(redirectTarget)),
  );
};
