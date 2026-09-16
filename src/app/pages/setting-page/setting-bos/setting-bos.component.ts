import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { Observable } from 'rxjs';
import {
  EquipmentService,
  BOSItem,
  CreateBOSItemPayload,
  UpdateBOSItemPayload,
} from '../../../services/equipment.service';

type BosCategory = 'cables' | 'switch_gears' | 'solar_equipment' | 'conduit_junction_boxes';

interface BOSRow {
  id: number | null;
  item: number | null;
  description: string;
  size: string;
  costPrice: number | null;
  saving: boolean;
}

interface CategoryOption {
  label: string;
  value: BosCategory;
}

interface CategoryApi {
  get: () => Observable<BOSItem[]>;
  create: (payload: CreateBOSItemPayload) => Observable<BOSItem>;
  update: (id: number, payload: UpdateBOSItemPayload) => Observable<BOSItem>;
  remove: (id: number) => Observable<void>;
}

function toBOSRow(b: BOSItem): BOSRow {
  return {
    id: b.id,
    item: b.item,
    description: b.description,
    size: b.size,
    costPrice: b.costPrice,
    saving: false,
  };
}

@Component({
  selector: 'app-setting-bos',
  imports: [FormsModule, SelectButtonModule, ToastModule, NgClass],
  templateUrl: './setting-bos.component.html',
  styleUrl: './setting-bos.component.scss',
  providers: [MessageService],
})
export class SettingBOSComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly categoryApi: Record<BosCategory, CategoryApi> = {
    cables: {
      get: () => this.equipmentService.getCables(),
      create: (p) => this.equipmentService.createCable(p),
      update: (id, p) => this.equipmentService.updateCable(id, p),
      remove: (id) => this.equipmentService.deleteCable(id),
    },
    switch_gears: {
      get: () => this.equipmentService.getSwitchGears(),
      create: (p) => this.equipmentService.createSwitchGear(p),
      update: (id, p) => this.equipmentService.updateSwitchGear(id, p),
      remove: (id) => this.equipmentService.deleteSwitchGear(id),
    },
    solar_equipment: {
      get: () => this.equipmentService.getSolarEquipment(),
      create: (p) => this.equipmentService.createSolarEquipment(p),
      update: (id, p) => this.equipmentService.updateSolarEquipment(id, p),
      remove: (id) => this.equipmentService.deleteSolarEquipment(id),
    },
    conduit_junction_boxes: {
      get: () => this.equipmentService.getConduitJunctionBoxes(),
      create: (p) => this.equipmentService.createConduitJunctionBox(p),
      update: (id, p) => this.equipmentService.updateConduitJunctionBox(id, p),
      remove: (id) => this.equipmentService.deleteConduitJunctionBox(id),
    },
  };

  readonly categoryOptions: CategoryOption[] = [
    { label: 'Cables', value: 'cables' },
    { label: 'Switch Gears', value: 'switch_gears' },
    { label: 'Solar Equipment', value: 'solar_equipment' },
    { label: 'Conduit & Junction Boxes', value: 'conduit_junction_boxes' },
  ];

  selectedCategory: BosCategory = 'cables';
  rowsByCategory: Record<BosCategory, BOSRow[]> = {
    cables: [],
    switch_gears: [],
    solar_equipment: [],
    conduit_junction_boxes: [],
  };
  accessoryRows: BOSRow[] = [];

  get rows(): BOSRow[] {
    return this.rowsByCategory[this.selectedCategory];
  }

  ngOnInit(): void {
    for (const category of this.categoryOptions.map((o) => o.value)) {
      this.categoryApi[category].get()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (items) => (this.rowsByCategory[category] = items.map(toBOSRow)),
          error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: `โหลดข้อมูล ${category} ไม่สำเร็จ` }),
        });
    }

    this.equipmentService.getBosAccessories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (accessories) => (this.accessoryRows = accessories.map(toBOSRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'โหลดข้อมูล Accessories ไม่สำเร็จ' }),
      });
  }

  addRow(): void {
    this.rows.push({ id: null, item: null, description: '', size: '', costPrice: null, saving: false });
  }

  saveRow(row: BOSRow): void {
    if (row.item === null || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอก Item และ Description ก่อนบันทึก' });
      return;
    }

    const api = this.categoryApi[this.selectedCategory];
    row.saving = true;
    const request$ = row.id === null
      ? api.create(this.buildPayload(row))
      : api.update(row.id, this.buildPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toBOSRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก Item ${saved.item} เรียบร้อย`, life: 2000 });
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
    if (!window.confirm(`ลบ Item ${row.item} - ${row.description} ออกจากรายการ?`)) return;

    this.categoryApi[this.selectedCategory].remove(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.rows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  addAccessoryRow(): void {
    this.accessoryRows.push({ id: null, item: null, description: '', size: '', costPrice: null, saving: false });
  }

  saveAccessoryRow(row: BOSRow): void {
    if (row.item === null || !row.description.trim()) {
      this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'กรุณากรอก Item และ Description ก่อนบันทึก' });
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createBosAccessory(this.buildPayload(row))
      : this.equipmentService.updateBosAccessory(row.id, this.buildPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toBOSRow(saved));
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: `บันทึก Item ${saved.item} เรียบร้อย`, life: 2000 });
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
    if (!window.confirm(`ลบ Item ${row.item} - ${row.description} ออกจากรายการ?`)) return;

    this.equipmentService.deleteBosAccessory(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.accessoryRows.splice(index, 1),
        error: () => this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'ลบไม่สำเร็จ ลองใหม่อีกครั้ง' }),
      });
  }

  private buildPayload(row: BOSRow): CreateBOSItemPayload {
    const payload: CreateBOSItemPayload = { item: row.item as number, description: row.description };
    if (row.size) payload.size = row.size;
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    return payload;
  }
}
