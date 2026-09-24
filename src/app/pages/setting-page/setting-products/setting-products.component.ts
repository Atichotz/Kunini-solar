import { Component, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingPanelsComponent } from '../setting-panels/setting-panels.component';
import { SettingInvertersComponent } from '../setting-inverters/setting-inverters.component';
import { SettingBatteriesComponent } from '../setting-batteries/setting-batteries.component';
import { SettingRackingComponent } from '../setting-racking/setting-racking.component';
import { SettingBOSComponent } from '../setting-bos/setting-bos.component';
import { SettingDocumentationsComponent } from '../setting-documentations/setting-documentations.component';
import { PermissionService } from '../../../services/permission.service';

type ProductTab = 'panels' | 'inverters' | 'batteries' | 'racking' | 'bos' | 'documentation';

@Component({
  selector: 'app-setting-products',
  imports: [FormsModule, SettingPanelsComponent, SettingInvertersComponent, SettingBatteriesComponent, SettingRackingComponent, SettingBOSComponent, SettingDocumentationsComponent],
  templateUrl: './setting-products.component.html',
  styleUrl: './setting-products.component.scss'
})
export class SettingProductsComponent {
  readonly canManage = inject(PermissionService).canManageProducts;

  // ใช้ @ViewChild แยกตามชนิด component เพราะแต่ละ tab render อยู่ตัวเดียวในแต่ละครั้ง (@if/@else if) — ตัวที่ไม่ได้ render จะเป็น undefined
  @ViewChild(SettingPanelsComponent) private panelsCmp?: SettingPanelsComponent;
  @ViewChild(SettingInvertersComponent) private invertersCmp?: SettingInvertersComponent;
  @ViewChild(SettingBatteriesComponent) private batteriesCmp?: SettingBatteriesComponent;
  @ViewChild(SettingRackingComponent) private rackingCmp?: SettingRackingComponent;
  @ViewChild(SettingBOSComponent) private bosCmp?: SettingBOSComponent;
  @ViewChild(SettingDocumentationsComponent) private documentationsCmp?: SettingDocumentationsComponent;

  activeTab: ProductTab = 'panels';
  searchQuery = '';

  // เปลี่ยน tab ต้องเคลียร์ search เดิมทิ้ง กัน user งงว่าทำไม tab ใหม่ดูเหมือนไม่มีข้อมูล
  selectTab(tab: ProductTab): void {
    this.activeTab = tab;
    this.searchQuery = '';
  }

  // เซฟทุกแถวของ tab ที่ active อยู่พร้อมกัน — dispatch ไปยัง child component ตัวที่ render อยู่จริง
  saveAllInActiveTab(): void {
    switch (this.activeTab) {
      case 'panels':
        this.panelsCmp?.saveAllRows();
        break;
      case 'inverters':
        this.invertersCmp?.saveAllRows();
        break;
      case 'batteries':
        this.batteriesCmp?.saveAllRows();
        break;
      case 'racking':
        this.rackingCmp?.saveAllRows();
        break;
      case 'bos':
        this.bosCmp?.saveAllRows();
        break;
      case 'documentation':
        this.documentationsCmp?.saveAllRows();
        break;
    }
  }
}
