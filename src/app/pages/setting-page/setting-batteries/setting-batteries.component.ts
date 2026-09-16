import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import {
  EquipmentService,
  BatteryItem,
  AccessoryItem,
  CreateBatteryPayload,
  CreateAccessoryPayload,
} from '../../../services/equipment.service';

interface BatteryRow {
  id: number | null;
  brand: string;
  kw: number | null;
  description: string;
  costPrice: number | null;
  shipping: number | null;
  salePrice: number | null;
  notes: string;
  saving: boolean;
}

interface AccessoryRow {
  id: number | null;
  brand: string;
  description: string;
  costPrice: number | null;
  shipping: number | null;
  salePrice: number | null;
  notes: string;
  saving: boolean;
}

function toBatteryRow(b: BatteryItem): BatteryRow {
  return {
    id: b.id,
    brand: b.brand,
    kw: b.kw,
    description: b.description,
    costPrice: b.costPrice,
    shipping: b.shipping,
    salePrice: b.salePrice,
    notes: b.notes,
    saving: false,
  };
}

function toAccessoryRow(a: AccessoryItem): AccessoryRow {
  return {
    id: a.id,
    brand: a.brand,
    description: a.description,
    costPrice: a.costPrice,
    shipping: a.shipping,
    salePrice: a.salePrice,
    notes: a.notes,
    saving: false,
  };
}

@Component({
  selector: 'app-setting-batteries',
  imports: [FormsModule, ToastModule, NgClass],
  templateUrl: './setting-batteries.component.html',
  styleUrl: './setting-batteries.component.scss',
  providers: [MessageService],
})
export class SettingBatteriesComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  rows: BatteryRow[] = [];
  accessoryRows: AccessoryRow[] = [];

  ngOnInit(): void {
    this.equipmentService.getBatteries()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (batteries) => (this.rows = batteries.map(toBatteryRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Batteries ไม่สำเร็จ' }),
      });

    this.equipmentService.getBatteryAccessories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accessories) => (this.accessoryRows = accessories.map(toAccessoryRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Accessories ไม่สำเร็จ' }),
      });
  }

  addRow(): void {
    this.rows.push({ id: null, brand: '', kw: null, description: '', costPrice: null, shipping: null, salePrice: null, notes: '', saving: false });
  }

  saveRow(row: BatteryRow): void {
    if (!row.brand || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอก Brand และ Description ก่อนบันทึก' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createBattery(this.buildPayload(row))
      : this.equipmentService.updateBattery(row.id, this.buildPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toBatteryRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก ${saved.brand} เรียบร้อย`, life: 2000 });
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
    if (!window.confirm(`ลบ ${row.brand} - ${row.description} ออกจากรายการ?`)) return;

    this.equipmentService.deleteBattery(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.rows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  private buildPayload(row: BatteryRow): CreateBatteryPayload {
    const payload: CreateBatteryPayload = { brand: row.brand, description: row.description };
    if (row.kw !== null) payload.kw = row.kw;
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    if (row.shipping !== null) payload.shipping = row.shipping;
    if (row.salePrice !== null) payload.salePrice = row.salePrice;
    if (row.notes) payload.notes = row.notes;
    return payload;
  }

  addAccessoryRow(): void {
    this.accessoryRows.push({ id: null, brand: '', description: '', costPrice: null, shipping: null, salePrice: null, notes: '', saving: false });
  }

  saveAccessoryRow(row: AccessoryRow): void {
    if (!row.brand || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอก Brand และ Description ก่อนบันทึก' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createBatteryAccessory(this.buildAccessoryPayload(row))
      : this.equipmentService.updateBatteryAccessory(row.id, this.buildAccessoryPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toAccessoryRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก ${saved.brand} เรียบร้อย`, life: 2000 });
      },
      error: () => {
        row.saving = false;
        this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' });
      },
    });
  }

  removeAccessoryRow(index: number): void {
    const row = this.accessoryRows[index];
    if (row.id === null) {
      this.accessoryRows.splice(index, 1);
      return;
    }
    if (!window.confirm(`ลบ ${row.brand} - ${row.description} ออกจากรายการ?`)) return;

    this.equipmentService.deleteBatteryAccessory(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.accessoryRows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  private buildAccessoryPayload(row: AccessoryRow): CreateAccessoryPayload {
    const payload: CreateAccessoryPayload = { brand: row.brand, description: row.description };
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    if (row.shipping !== null) payload.shipping = row.shipping;
    if (row.salePrice !== null) payload.salePrice = row.salePrice;
    if (row.notes) payload.notes = row.notes;
    return payload;
  }
}
