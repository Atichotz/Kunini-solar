import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { filter, take, Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { UsersService, UserListItem, AddGoogleUserPayload } from '../../../services/users.service';

interface ResetForm {
  newPassword: string;
  confirm: string;
}

interface CreateForm {
  loginType: 'username' | 'google';
  name: string;
  email: string;
  username: string;
  password: string;
  confirm: string;
  role: string;
}

@Component({
  selector: 'app-setting-account',
  imports: [CommonModule, FormsModule, DialogModule, SelectModule, TooltipModule],
  templateUrl: './setting-account.component.html',
  styleUrl: './setting-account.component.scss',
})
export class SettingAccountComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly usersService = inject(UsersService);

  profile$ = this.auth.currentProfile$;

  users: UserListItem[] = [];
  isLoadingUsers = false;

  // --- Reset Password Dialog ---
  showResetDialog = false;
  resetTarget: UserListItem | null = null;
  resetForm: ResetForm = { newPassword: '', confirm: '' };
  resetLoading = false;
  resetError = '';
  resetSuccess = false;

  // --- Create User Dialog ---
  showCreateDialog = false;
  createForm: CreateForm = { loginType: 'username', name: '', email: '', username: '', password: '', confirm: '', role: 'technician' };
  createLoading = false;
  createError = '';

  private profileSub: Subscription | null = null;

  // --- Inline edit name ---
  editingUserId: string | null = null;
  editingName = '';
  editSaving = false;

  readonly roleOptions = [
    { label: 'CEO', value: 'ceo' },
    { label: 'Admin', value: 'admin' },
    { label: 'Purchasing', value: 'purchasing' },
    { label: 'Technician', value: 'technician' },
  ];

  readonly roleLabels: Record<string, string> = {
    ceo: 'CEO',
    admin: 'Admin',
    purchasing: 'Purchasing',
    technician: 'Technician',
  };

  ngOnInit(): void {
    // รอ profile โหลดก่อน เผื่อ fetch ยังไม่เสร็จตอน component init
    this.profileSub = this.profile$
      .pipe(filter((p) => p !== null), take(1))
      .subscribe((p) => {
        if (p?.role === 'ceo') this.loadUsers();
      });
  }

  ngOnDestroy(): void {
    this.profileSub?.unsubscribe();
  }

  loadUsers(): void {
    this.isLoadingUsers = true;
    this.usersService.getUsers().subscribe({
      next: (list) => {
        this.users = list;
        this.isLoadingUsers = false;
      },
      error: (err) => {
        this.isLoadingUsers = false;
      },
    });
  }

  // ===== Reset Password =====

  openResetDialog(user: UserListItem): void {
    this.resetTarget = user;
    this.resetForm = { newPassword: '', confirm: '' };
    this.resetError = '';
    this.resetSuccess = false;
    this.showResetDialog = true;
  }

  submitReset(): void {
    if (!this.resetTarget) return;

    if (this.resetForm.newPassword.length < 8) {
      this.resetError = 'Password ต้องมีอย่างน้อย 8 ตัวอักษร';
      return;
    }
    if (!/\d/.test(this.resetForm.newPassword)) {
      this.resetError = 'Password ต้องมีตัวเลขอย่างน้อย 1 ตัว';
      return;
    }
    if (this.resetForm.newPassword !== this.resetForm.confirm) {
      this.resetError = 'Password ไม่ตรงกัน';
      return;
    }

    this.resetLoading = true;
    this.resetError = '';
    this.usersService.resetPassword(this.resetTarget.userId, this.resetForm.newPassword).subscribe({
      next: () => {
        this.resetLoading = false;
        this.resetSuccess = true;
      },
      error: (err) => {
        this.resetLoading = false;
        this.resetError = err?.error?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      },
    });
  }

  // ===== Edit Name (inline) =====

  startEdit(user: UserListItem): void {
    this.editingUserId = user.userId;
    this.editingName = user.name;
  }

  cancelEdit(): void {
    this.editingUserId = null;
    this.editingName = '';
  }

  saveName(user: UserListItem): void {
    const trimmed = this.editingName.trim();
    if (!trimmed || trimmed === user.name) {
      this.cancelEdit();
      return;
    }

    this.editSaving = true;
    this.usersService.updateName(user.userId, trimmed).subscribe({
      next: () => {
        this.users = this.users.map((u) =>
          u.userId === user.userId ? { ...u, name: trimmed } : u,
        );
        this.editingUserId = null;
        this.editSaving = false;
      },
      error: (err) => {
        console.error('[SettingAccount] updateName failed', err);
        this.editSaving = false;
      },
    });
  }

  // ===== Create User =====

  openCreateDialog(): void {
    this.createForm = { loginType: 'username', name: '', email: '', username: '', password: '', confirm: '', role: 'technician' };
    this.createError = '';
    this.showCreateDialog = true;
  }

  submitCreate(): void {
    const { loginType, name, email, username, password, confirm, role } = this.createForm;

    if (!name.trim()) { this.createError = 'กรุณากรอกชื่อ'; return; }

    if (loginType === 'google') {
      if (!email.trim()) { this.createError = 'กรุณากรอก Gmail'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        this.createError = 'รูปแบบ Email ไม่ถูกต้อง';
        return;
      }

      this.createLoading = true;
      this.createError = '';
      const payload: AddGoogleUserPayload = { email: email.trim(), name: name.trim(), role };
      this.usersService.addGoogleUser(payload).subscribe({
        next: () => {
          this.createLoading = false;
          this.showCreateDialog = false;
          this.loadUsers();
        },
        error: (err) => {
          this.createLoading = false;
          this.createError = err?.error?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
        },
      });
      return;
    }

    // Username/Password flow
    if (!username.trim()) { this.createError = 'กรุณากรอก Username'; return; }
    if (!/^[a-z0-9_]+$/.test(username)) {
      this.createError = 'Username ใช้ได้แค่ a-z, 0-9, _ เท่านั้น';
      return;
    }
    if (password.length < 8) { this.createError = 'Password ต้องมีอย่างน้อย 8 ตัวอักษร'; return; }
    if (!/\d/.test(password)) { this.createError = 'Password ต้องมีตัวเลขอย่างน้อย 1 ตัว'; return; }
    if (password !== confirm) { this.createError = 'Password ไม่ตรงกัน'; return; }

    this.createLoading = true;
    this.createError = '';
    this.usersService.createUser({ name: name.trim(), username: username.trim(), password, role }).subscribe({
      next: () => {
        this.createLoading = false;
        this.showCreateDialog = false;
        this.loadUsers();
      },
      error: (err) => {
        this.createLoading = false;
        this.createError = err?.error?.message ?? 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      },
    });
  }
}
