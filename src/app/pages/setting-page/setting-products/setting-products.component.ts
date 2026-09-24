import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingPanelsComponent } from '../setting-panels/setting-panels.component';
import { SettingInvertersComponent } from '../setting-inverters/setting-inverters.component';
import { SettingBatteriesComponent } from '../setting-batteries/setting-batteries.component';
import { SettingRackingComponent } from '../setting-racking/setting-racking.component';
import { SettingBOSComponent } from '../setting-bos/setting-bos.component';
import { SettingDocumentationsComponent } from '../setting-documentations/setting-documentations.component';

type ProductTab = 'panels' | 'inverters' | 'batteries' | 'racking' | 'bos' | 'documentation';

@Component({
  selector: 'app-setting-products',
  imports: [FormsModule, SettingPanelsComponent, SettingInvertersComponent, SettingBatteriesComponent, SettingRackingComponent, SettingBOSComponent, SettingDocumentationsComponent],
  templateUrl: './setting-products.component.html',
  styleUrl: './setting-products.component.scss'
})
export class SettingProductsComponent {
  activeTab: ProductTab = 'panels';
  searchQuery = '';

  // เปลี่ยน tab ต้องเคลียร์ search เดิมทิ้ง กัน user งงว่าทำไม tab ใหม่ดูเหมือนไม่มีข้อมูล
  selectTab(tab: ProductTab): void {
    this.activeTab = tab;
    this.searchQuery = '';
  }
}
