import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { filter, take, Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { PermissionService } from '../../../services/permission.service';
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

  private readonly permission = inject(PermissionService);
  readonly canManage = this.permission.canManage;
  readonly isCeo = this.permission.isCeo;
  profile$ = this.auth.currentProfile$;

  users: UserListItem[] = [];
  isLoadingUsers = false;
  // โหลดรายชื่อไม่สำเร็จ — แยกจาก "ไม่มีผู้ใช้" ให้ผู้ใช้เห็นว่าพังและกด Retry ได้
  usersLoadError = '';

  // --- Reset Password Dialog ---
  showResetDialog = false;
  resetTarget: UserListItem | null = null;
  resetForm: ResetForm = { newPassword: '', confirm: '' };
  resetLoading = false;
  resetError = '';
  resetSuccess = false;

  // --- Change Role Dialog ---
  showRoleDialog = false;
  roleTarget: UserListItem | null = null;
  selectedRole: UserListItem['role'] = 'technician';
  roleLoading = false;
  roleError = '';

  // --- Delete User Dialog ---
  showDeleteDialog = false;
  deleteTarget: UserListItem | null = null;
  deleteLoading = false;
  deleteError = '';

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
  editError = '';

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
        if (this.canManage()) this.loadUsers();
      });
  }

  ngOnDestroy(): void {
    this.profileSub?.unsubscribe();
  }

  loadUsers(): void {
    this.isLoadingUsers = true;
    this.usersLoadError = '';
    this.usersService.getUsers().subscribe({
      next: (list) => {
        this.users = list;
        this.isLoadingUsers = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[SettingAccount] loadUsers failed', err);
        this.isLoadingUsers = false;
        this.usersLoadError = err.error?.message ?? 'Failed to load users. Please try again';
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
    if (!this.resetTarget || this.resetLoading) return;

    if (this.resetForm.newPassword.length < 8) {
      this.resetError = 'Password must be at least 8 characters';
      return;
    }
    if (!/\d/.test(this.resetForm.newPassword)) {
      this.resetError = 'Password must contain at least 1 digit';
      return;
    }
    if (this.resetForm.newPassword !== this.resetForm.confirm) {
      this.resetError = 'Passwords do not match';
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
        this.resetError = err?.error?.message ?? 'Something went wrong. Please try again';
      },
    });
  }

  // ===== Edit Name (inline) =====

  startEdit(user: UserListItem): void {
    this.editingUserId = user.userId;
    this.editingName = user.name;
    this.editError = '';
  }

  cancelEdit(): void {
    this.editingUserId = null;
    this.editingName = '';
    this.editError = '';
  }

  saveName(user: UserListItem): void {
    if (this.editSaving) return;

    const trimmed = this.editingName.trim();
    if (!trimmed || trimmed === user.name) {
      this.cancelEdit();
      return;
    }

    this.editSaving = true;
    this.editError = '';
    this.usersService.updateName(user.userId, trimmed).subscribe({
      next: () => {
        this.users = this.users.map((u) =>
          u.userId === user.userId ? { ...u, name: trimmed } : u,
        );
        this.editingUserId = null;
        this.editSaving = false;
      },
      error: (err: HttpErrorResponse) => {
        console.error('[SettingAccount] updateName failed', err);
        this.editSaving = false;
        // ช่องแก้ไขเปิดค้างไว้ให้กดลองใหม่ได้
        this.editError = err.error?.message ?? 'Failed to update name. Please try again';
        // 403/404 = list ในหน้าเก่าแล้ว (เช่น ถูกลบจาก tab อื่น) → โหลดใหม่
        if (err.status === 403 || err.status === 404) this.loadUsers();
      },
    });
  }

  // ===== Change Role =====

  // input: user ที่ต้องการเปลี่ยน role — CEO เท่านั้นที่เปิดได้ และไม่เปิดให้แถวที่เป็น CEO อยู่แล้ว
  openRoleDialog(user: UserListItem): void {
    if (!this.isCeo() || user.role === 'ceo') return;
    this.roleTarget = user;
    this.selectedRole = user.role;
    this.roleError = '';
    this.showRoleDialog = true;
  }

  submitRole(): void {
    const target = this.roleTarget;
    if (!target || this.roleLoading || this.selectedRole === target.role) return;

    const newRole = this.selectedRole;
    this.roleLoading = true;
    this.roleError = '';
    this.usersService.updateRole(target.userId, newRole).subscribe({
      next: () => {
        this.users = this.users.map((u) =>
          u.userId === target.userId ? { ...u, role: newRole } : u,
        );
        this.roleLoading = false;
        this.showRoleDialog = false;
      },
      error: (err: HttpErrorResponse) => {
        this.roleLoading = false;
        this.roleError = err.error?.message ?? 'Something went wrong. Please try again';
        // 403/404 = list ในหน้าเก่าแล้ว (เช่น target ถูกตั้งเป็น CEO หรือถูกลบจาก tab อื่น) → โหลดใหม่
        if (err.status === 403 || err.status === 404) this.loadUsers();
      },
    });
  }

  // ===== Delete User (soft delete) =====

  // input: user ที่ต้องการลบ — CEO เท่านั้นที่เปิดได้ และไม่เปิดให้แถวที่เป็น CEO
  openDeleteDialog(user: UserListItem): void {
    if (!this.isCeo() || user.role === 'ceo') return;
    this.deleteTarget = user;
    this.deleteError = '';
    this.showDeleteDialog = true;
  }

  submitDelete(): void {
    const target = this.deleteTarget;
    if (!target || this.deleteLoading) return;

    this.deleteLoading = true;
    this.deleteError = '';
    this.usersService.deleteUser(target.userId).subscribe({
      next: () => {
        this.users = this.users.filter((u) => u.userId !== target.userId);
        this.deleteLoading = false;
        this.showDeleteDialog = false;
      },
      error: (err: HttpErrorResponse) => {
        this.deleteLoading = false;
        // 409 = มีงานค้าง → แสดงเหตุผลจาก backend ตรงๆ
        this.deleteError = err.error?.message ?? 'Something went wrong. Please try again';
        // 403/404 = list ในหน้าเก่าแล้ว (เช่น ถูกลบจาก tab อื่น) → โหลดใหม่
        if (err.status === 403 || err.status === 404) this.loadUsers();
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
    if (this.createLoading) return;

    const { loginType, name, email, username, password, confirm, role } = this.createForm;

    if (!name.trim()) { this.createError = 'Please enter a name'; return; }

    if (loginType === 'google') {
      if (!email.trim()) { this.createError = 'Please enter a Gmail address'; return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        this.createError = 'Invalid email format';
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
          this.createError = err?.error?.message ?? 'Something went wrong. Please try again';
        },
      });
      return;
    }

    // Username/Password flow
    if (!username.trim()) { this.createError = 'Please enter a username'; return; }
    if (!/^[a-z0-9_]+$/.test(username)) {
      this.createError = 'Username may only contain a-z, 0-9, and _';
      return;
    }
    if (password.length < 8) { this.createError = 'Password must be at least 8 characters'; return; }
    if (!/\d/.test(password)) { this.createError = 'Password must contain at least 1 digit'; return; }
    if (password !== confirm) { this.createError = 'Passwords do not match'; return; }

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
        this.createError = err?.error?.message ?? 'Something went wrong. Please try again';
      },
    });
  }
}
