import { Component, computed, inject, signal } from '@angular/core';
import { PermissionService } from '../../services/permission.service';
import { SettingAccountComponent } from './setting-account/setting-account.component';
import { SettingProductsComponent } from './setting-products/setting-products.component';
import { SettingDeletedCustomersComponent } from './setting-deleted-customers/setting-deleted-customers.component';

type SettingSection = 'account' | 'products' | 'deleted-customers';

@Component({
  selector: 'app-setting-page',
  imports: [SettingAccountComponent, SettingProductsComponent, SettingDeletedCustomersComponent],
  templateUrl: './setting-page.component.html',
  styleUrl: './setting-page.component.scss'
})
export class SettingPageComponent {
  private readonly permission = inject(PermissionService);
  readonly canManage = this.permission.canManage;
  // Deleted Customers เป็นของ CEO เท่านั้น (สิทธิ์จริงอยู่ที่ backend @Roles('ceo'))
  readonly isCeo = this.permission.isCeo;

  private readonly selectedSection = signal<SettingSection>('account');

  // ไม่มีสิทธิ์ → บังคับ products เสมอ (รวมช่วง profile ยังโหลดไม่เสร็จ และกรณี role เปลี่ยนระหว่างใช้งาน)
  readonly activeSection = computed<SettingSection>(() => {
    const selected = this.selectedSection();
    return this.canOpenSection(selected) ? selected : 'products';
  });

  selectSection(section: SettingSection): void {
    if (!this.canOpenSection(section)) return;
    this.selectedSection.set(section);
  }

  // input: section ที่ต้องการเปิด — output: true ถ้า role ปัจจุบันเปิดได้ (products เปิดได้ทุก role ที่เข้า Settings ได้)
  private canOpenSection(section: SettingSection): boolean {
    if (section === 'account') return this.canManage();
    if (section === 'deleted-customers') return this.isCeo();
    return true;
  }
}
