import { Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ToastModule } from 'primeng/toast';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { MessageService, ConfirmationService } from 'primeng/api';
import { Observable, finalize } from 'rxjs';
import {
  EquipmentService,
  BOSItem,
  CreateBOSItemPayload,
  UpdateBOSItemPayload,
} from '../../../services/equipment.service';
import { PermissionService } from '../../../services/permission.service';
import { SaveOpts, SaveTask, runSaveAllBatch } from '../save-all-batch.util';

type BosCategory = 'cables' | 'switch_gears' | 'solar_equipment' | 'conduit_junction_boxes';

interface BOSRow {
  id: number | null;
  item: number | null;
  description: string;
  size: string;
  costPrice: number | null;
  saving: boolean;
  deleting?: boolean;
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
  imports: [FormsModule, SelectButtonModule, ToastModule, ConfirmDialogModule, NgClass],
  templateUrl: './setting-bos.component.html',
  styleUrl: './setting-bos.component.scss',
  providers: [MessageService, ConfirmationService],
})
export class SettingBOSComponent implements OnInit {
  private readonly equipmentService = inject(EquipmentService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);
  readonly canManage = inject(PermissionService).canManageProducts;

  @Input() searchQuery = '';

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

  // โหลดแยกต่อหมวด — แต่ละหมวดยิง request ของตัวเอง ผู้ใช้อาจสลับไปหมวดที่ยังโหลดไม่เสร็จ
  isLoadingByCategory: Record<BosCategory, boolean> = {
    cables: true,
    switch_gears: true,
    solar_equipment: true,
    conduit_junction_boxes: true,
  };
  isLoadingAccessories = true;

  get isLoadingRows(): boolean {
    return this.isLoadingByCategory[this.selectedCategory];
  }

  get rows(): BOSRow[] {
    return this.rowsByCategory[this.selectedCategory];
  }

  get filteredRows(): BOSRow[] {
    return this.rows.filter((r) => this.matchesSearch(r.description, r.size));
  }

  get filteredAccessoryRows(): BOSRow[] {
    return this.accessoryRows.filter((r) => this.matchesSearch(r.description, r.size));
  }

  private matchesSearch(...values: (string | null | undefined)[]): boolean {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return true;
    return values.some((v) => (v ?? '').toLowerCase().includes(q));
  }

  ngOnInit(): void {
    for (const category of this.categoryOptions.map((o) => o.value)) {
      this.categoryApi[category].get()
        .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingByCategory[category] = false)))
        .subscribe({
          next: (items) => (this.rowsByCategory[category] = items.map(toBOSRow)),
          error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: `Failed to load ${category}` }),
        });
    }

    this.equipmentService.getBosAccessories()
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => (this.isLoadingAccessories = false)))
      .subscribe({
        next: (accessories) => (this.accessoryRows = accessories.map(toBOSRow)),
        error: () => this.messageService.add({ severity: 'error', summary: 'Load Failed', detail: 'Failed to load accessories' }),
      });
  }

  addRow(): void {
    if (!this.canManage()) return;
    this.rows.push({ id: null, item: null, description: '', size: '', costPrice: null, saving: false });
  }

  saveRow(row: BOSRow, opts?: SaveOpts): void {
    if (!this.canManage()) return;
    if (row.item === null || !row.description.trim()) {
      if (!opts?.silent) {
        this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please fill in Item and Description before saving' });
      }
      opts?.onDone?.(false);
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
        if (!opts?.silent) {
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Item ${saved.item} saved successfully`, life: 2000 });
        }
        opts?.onDone?.(true);
      },
      error: () => {
        row.saving = false;
        if (!opts?.silent) {
          this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to save. Please try again' });
        }
        opts?.onDone?.(false);
      },
    });
  }

  // เซฟทุกแถวพร้อมกัน — เฉพาะ category ที่เลือกอยู่ + accessory, ยิงแบบ silent แล้วรอครบทุกแถวค่อยขึ้น toast สรุปครั้งเดียว
  saveAllRows(): void {
    if (!this.canManage()) return;
    const tasks: SaveTask[] = [];
    for (const row of this.rows) {
      if (row.saving || row.deleting) continue;
      if (row.id === null && row.item === null && !row.description.trim()) continue;
      tasks.push((onDone) => this.saveRow(row, { silent: true, onDone }));
    }
    for (const row of this.accessoryRows) {
      if (row.saving || row.deleting) continue;
      if (row.id === null && row.item === null && !row.description.trim()) continue;
      tasks.push((onDone) => this.saveAccessoryRow(row, { silent: true, onDone }));
    }
    runSaveAllBatch(tasks, this.messageService);
  }

  // input: แถวที่กด Remove — จำหมวดตอนกด (ไม่ใช่ตอน response กลับ) เพราะผู้ใช้อาจสลับหมวดระหว่างรอ ไม่งั้นจะลบ/splice ผิดหมวด
  removeRow(row: BOSRow): void {
    if (!this.canManage()) return;
    if (row.saving || row.deleting) return;
    const category = this.selectedCategory;
    const removeFromList = (): void => {
      this.rowsByCategory[category] = this.rowsByCategory[category].filter((r) => r !== row);
    };
    if (row.id === null) {
      removeFromList();
      return;
    }
    const id = row.id;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove Item ${row.item} - ${row.description} from the list?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        row.deleting = true;
        this.categoryApi[category].remove(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: removeFromList,
            error: () => {
              row.deleting = false;
              this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'Failed to delete. Please try again' });
            },
          });
      },
    });
  }

  addAccessoryRow(): void {
    if (!this.canManage()) return;
    this.accessoryRows.push({ id: null, item: null, description: '', size: '', costPrice: null, saving: false });
  }

  saveAccessoryRow(row: BOSRow, opts?: SaveOpts): void {
    if (!this.canManage()) return;
    if (row.item === null || !row.description.trim()) {
      if (!opts?.silent) {
        this.messageService.add({ severity: 'warn', summary: 'Incomplete', detail: 'Please fill in Item and Description before saving' });
      }
      opts?.onDone?.(false);
      return;
    }

    row.saving = true;
    const request$ = row.id === null
      ? this.equipmentService.createBosAccessory(this.buildPayload(row))
      : this.equipmentService.updateBosAccessory(row.id, this.buildPayload(row));

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        Object.assign(row, toBOSRow(saved));
        if (!opts?.silent) {
          this.messageService.add({ severity: 'success', summary: 'Saved', detail: `Item ${saved.item} saved successfully`, life: 2000 });
        }
        opts?.onDone?.(true);
      },
      error: () => {
        row.saving = false;
        if (!opts?.silent) {
          this.messageService.add({ severity: 'error', summary: 'Save Failed', detail: 'Failed to save. Please try again' });
        }
        opts?.onDone?.(false);
      },
    });
  }

  removeAccessoryRow(row: BOSRow): void {
    if (!this.canManage()) return;
    if (row.saving || row.deleting) return;
    if (row.id === null) {
      this.accessoryRows = this.accessoryRows.filter((r) => r !== row);
      return;
    }
    const id = row.id;
    this.confirmationService.confirm({
      header: 'Confirm Delete',
      message: `Remove Item ${row.item} - ${row.description} from the list?`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      accept: () => {
        row.deleting = true;
        this.equipmentService.deleteBosAccessory(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            // filter ด้วย reference (ไม่ใช้ index) กันลบผิดแถวถ้า list เปลี่ยนระหว่างรอ confirm/response
            next: () => (this.accessoryRows = this.accessoryRows.filter((r) => r !== row)),
            error: () => {
              row.deleting = false;
              this.messageService.add({ severity: 'error', summary: 'Delete Failed', detail: 'Failed to delete. Please try again' });
            },
          });
      },
    });
  }

  private buildPayload(row: BOSRow): CreateBOSItemPayload {
    const payload: CreateBOSItemPayload = { item: row.item as number, description: row.description };
    if (row.size) payload.size = row.size;
    if (row.costPrice !== null) payload.costPrice = row.costPrice;
    return payload;
  }
}
