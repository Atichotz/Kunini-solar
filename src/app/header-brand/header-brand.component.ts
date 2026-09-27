import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from "@angular/router";
import { AuthService } from '../services/auth.service';
import { salesRepNameOf } from '../quotation-snapshot.util';
import { Tooltip } from "primeng/tooltip";
import { Popover } from 'primeng/popover';
import { CustomerListDrawerComponent } from '../customer-list-drawer/customer-list-drawer.component';
import { AddTaskDialogComponent } from '../add-task-dialog/add-task-dialog.component';

@Component({
  selector: 'app-header-brand',
  imports: [RouterLink, RouterLinkActive, Tooltip, Popover, CustomerListDrawerComponent, AddTaskDialogComponent],
  templateUrl: './header-brand.component.html',
  styleUrl: './header-brand.component.scss'
})
export class HeaderBrandComponent {
  private readonly authService = inject(AuthService);

  isLoggingOut = false;

  private readonly profile = toSignal(this.authService.currentProfile$, { initialValue: null });

  // '' ถ้า profile ยังโหลดไม่เสร็จ/โหลดไม่สำเร็จ → template ซ่อนส่วนชื่อทั้งก้อน
  readonly userName = computed(() => salesRepNameOf(this.profile()));
  readonly userInitial = computed(() => this.userName().charAt(0).toUpperCase());

  // รูป Google หลุด/โหลดไม่ขึ้น → fallback เป็นตัวอักษรแรก
  private readonly failedAvatarUrl = signal<string | null>(null);
  readonly avatarUrl = computed(() => {
    const url = this.profile()?.avatarUrl ?? null;
    return url && url !== this.failedAvatarUrl() ? url : null;
  });

  onAvatarError(): void {
    this.failedAvatarUrl.set(this.profile()?.avatarUrl ?? null);
  }

  async logout(): Promise<void> {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;
    try {
      await this.authService.logout();
    } catch (err: unknown) {
      console.error('[Auth] Logout failed:', err);
    } finally {
      // ไม่งั้นถ้า signOut พัง flag จะค้าง true แล้วกด logout อีกครั้งไม่ได้
      this.isLoggingOut = false;
    }
  }
}
