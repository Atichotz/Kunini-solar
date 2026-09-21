import { Component, computed, inject, signal } from '@angular/core';
import { PermissionService } from '../../services/permission.service';
import { SettingAccountComponent } from './setting-account/setting-account.component';
import { SettingProductsComponent } from './setting-products/setting-products.component';

type SettingSection = 'account' | 'products';

@Component({
  selector: 'app-setting-page',
  imports: [SettingAccountComponent, SettingProductsComponent],
  templateUrl: './setting-page.component.html',
  styleUrl: './setting-page.component.scss'
})
export class SettingPageComponent {
  readonly canManage = inject(PermissionService).canManage;

  private readonly selectedSection = signal<SettingSection>('account');

  // ไม่มีสิทธิ์ → บังคับ products เสมอ (รวมช่วง profile ยังโหลดไม่เสร็จ และกรณี role เปลี่ยนระหว่างใช้งาน)
  readonly activeSection = computed<SettingSection>(() =>
    this.canManage() ? this.selectedSection() : 'products'
  );

  selectSection(section: SettingSection): void {
    if (section === 'account' && !this.canManage()) return;
    this.selectedSection.set(section);
  }
}
