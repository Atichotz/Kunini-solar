import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { environment } from '../../environments/environment';

// แนบ Supabase JWT เฉพาะ request ที่ยิงไป backend ของเราเอง (apiUrl) — กันไม่ให้ JWT หลุดไปปนกับ request ไปโดเมนอื่น เช่น Google Calendar API
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const token = inject(AuthService).getAccessToken();

  if (!token) return next(req);
  return next(
    req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }),
  );
};
