import { Component, inject } from '@angular/core';
import { RouterLink } from "@angular/router";
import { AuthService } from '../services/auth.service';
import { Tooltip } from "primeng/tooltip";

@Component({
  selector: 'app-header-brand',
  imports: [RouterLink, Tooltip],
  templateUrl: './header-brand.component.html',
  styleUrl: './header-brand.component.scss'
})
export class HeaderBrandComponent {
  private readonly authService = inject(AuthService);

  isLoggingOut = false;

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
