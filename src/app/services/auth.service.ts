import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface UserProfile {
  userId: string;
  role: 'ceo' | 'purchasing' | 'admin' | 'technician';
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  loginType: 'google' | 'username';
  username: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  // แยก state ชัดเจนด้วย undefined = loading
  readonly session$ = new BehaviorSubject<Session | null | undefined>(undefined);
  readonly currentProfile$ = new BehaviorSubject<UserProfile | null>(null);

  // Supabase client สร้างได้แค่ใน browser เพราะใช้ localStorage
  private supabase: SupabaseClient | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.supabase = createClient(
        environment.supabaseUrl,
        environment.supabaseAnonKey,
        {
          auth: {
            // zone.js patches Promise globally ทำให้ navigator.locks ทำงานผิดปกติ
            // override ให้ใช้ blocking lock แทน ifAvailable ที่ fail ทันที
            lock: <R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> =>
              navigator.locks.request(name, fn),
          },
        }
      );
      this.initAuthListener();
    }
  }

  private initAuthListener(): void {
    this.supabase!.auth.onAuthStateChange((event, session) => {
      this.session$.next(session);

      if (event === 'INITIAL_SESSION' && session) {
        this.fetchProfile();
        // app โหลดครั้งแรกแล้วมี session อยู่แล้ว → ไม่ให้ค้างที่ /login
        if (this.router.url === '/login' || this.router.url.startsWith('/auth/callback')) {
          this.router.navigate(['/dashboard']);
        }
      } else if (event === 'SIGNED_IN') {
        this.fetchProfile();
        // Google OAuth เท่านั้น — username login ให้ LoginPage navigate เอง
        if (this.router.url.startsWith('/auth/callback')) {
          this.router.navigate(['/dashboard']);
        }
      } else if (event === 'SIGNED_OUT') {
        this.currentProfile$.next(null);
        this.router.navigate(['/login']);
      }
    });
  }

  private fetchProfile(): void {
    this.http.get<UserProfile>(`${environment.apiUrl}/users/me`).subscribe({
      next: (profile) => this.currentProfile$.next(profile),
      error: (err) => console.error('[AuthService] fetchProfile failed', err),
    });
  }

  async loginWithGoogle(): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw error;
  }

  // username ไม่มี @ — แปลงเป็น email@kunini.local ก่อน signIn
  async loginWithUsername(username: string, password: string): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.auth.signInWithPassword({
      email: `${username}@kunini.local`,
      password,
    });
    if (error) throw error;
  }

  async logout(): Promise<void> {
    if (!this.supabase) return;
    await this.supabase.auth.signOut();
  }

  get currentUser() {
    return this.session$.value?.user ?? null;
  }

  // คืน JWT token ปัจจุบัน หรือ null ถ้าไม่ได้ login
  getAccessToken(): string | null {
    return this.session$.value?.access_token ?? null;
  }

  get supabaseClient(): SupabaseClient | null {
    return this.supabase;
  }
}
