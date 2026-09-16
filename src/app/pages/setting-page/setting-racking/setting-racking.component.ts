import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import {
  EquipmentService,
  RoofTypeItem,
  SolarRackingItem,
  CreateRackingPayload,
  UpdateRackingPayload,
} from '../../../services/equipment.service';

interface RackingRow {
  id: number | null;
  roofTypeId: number | null;
  part: string;
  description: string;
  costPrice: number | null;
  salePrice: number | null;
  saving: boolean;
}

interface RoofTypeOption {
  label: string;
  value: number;
}

function toRackingRow(r: SolarRackingItem): RackingRow {
  return {
    id: r.id,
    roofTypeId: r.roofTypeId,
    part: r.part,
    description: r.description,
    costPrice: r.costPrice,
    salePrice: r.salePrice,
    saving: false,
  };
}

@Component({
  selector: 'app-setting-racking',
  imports: [FormsModule, SelectModule, ToastModule, NgClass],
  templateUrl: './setting-racking.component.html',
  styleUrl: './setting-racking.component.scss',
  providers: [MessageService],
})
export class SettingRackingComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  rows: RackingRow[] = [];
  roofTypeOptions: RoofTypeOption[] = [];
  newRoofTypeName = '';
  addingRoofType = false;
  showAddRoofTypeForm = false;

  ngOnInit(): void {
    this.equipmentService.getRoofTypes()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (roofTypes: RoofTypeItem[]) => (this.roofTypeOptions = roofTypes.map((r) => ({ label: r.name, value: r.id }))),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Roof Types ไม่สำเร็จ' }),
      });

    this.equipmentService.getSolarRacking()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => (this.rows = items.map(toRackingRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Solar Racking ไม่สำเร็จ' }),
      });
  }

  addRoofType(): void {
    const name = this.newRoofTypeName.trim();
    if (!name) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอกชื่อ Roof Type ก่อนเพิ่ม' });
      return;
    }

    this.addingRoofType = true;
    this.equipmentService.createRoofType({ name })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (roofType) => {
          this.roofTypeOptions = [...this.roofTypeOptions, { label: roofType.name, value: roofType.id }];
          this.newRoofTypeName = '';
          this.addingRoofType = false;
          this.showAddRoofTypeForm = false;
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: `เพิ่ม Roof Type "${roofType.name}" เรียบร้อย`, life: 2000 });
        },
        error: () => {
          this.addingRoofType = false;
          this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'เพิ่ม Roof Type ไม่สำเร็จ ลองใหม่อีกครั้ง' });
        },
      });
  }

  cancelAddRoofType(): void {
    this.newRoofTypeName = '';
    this.showAddRoofTypeForm = false;
  }

  addRow(): void {
    this.rows.push({ id: null, roofTypeId: null, part: '', description: '', costPrice: null, salePrice: null, saving: false });
  }

  saveRow(row: RackingRow): void {
    if (row.roofTypeId === null || !row.part.trim() || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณาเลือก Roof Type และกรอก Part กับ Description ก่อนบันทึก' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createSolarRacking(this.buildCreatePayload(row))
      : this.equipmentService.updateSolarRacking(row.id, this.buildUpdatePayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toRackingRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก ${saved.part} เรียบร้อย`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' });
      },
    });
  }

  removeRow(index: number): void {
    const row = this.rows[index];
    if (row.id === null) {
      this.rows.splice(index, 1);
      return;
    }
    if (!window.confirm(`ลบ ${row.part} - ${row.description} ออกจากรายการ?`)) return;

    this.equipmentService.deleteSolarRacking(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.rows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  private buildCreatePayload(row: RackingRow): CreateRackingPayload {
    const payload: CreateRackingPayload = { roofTypeId: row.roofTypeId as number, part: row.part, description: row.description };
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    if (row.salePrice !== null) payload.salePrice = row.salePrice;
    return payload;
  }

  private buildUpdatePayload(row: RackingRow): UpdateRackingPayload {
    return this.buildCreatePayload(row);
  }
}
