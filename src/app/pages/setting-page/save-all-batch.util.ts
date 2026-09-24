import { MessageService } from 'primeng/api';

export interface SaveOpts {
  silent?: boolean;
  onDone?: (ok: boolean) => void;
}

export type SaveTask = (onDone: (ok: boolean) => void) => void;

// รัน task เซฟหลายแถวพร้อมกัน (แต่ละ task ต้องเรียก onDone(ok) เมื่อ request เสร็จ) แล้วขึ้น toast สรุปผลครั้งเดียวหลังครบทุก task
export function runSaveAllBatch(tasks: SaveTask[], messageService: MessageService): void {
  const total = tasks.length;
  if (total === 0) {
    messageService.add({ severity: 'info', summary: 'Nothing to Save', detail: 'No changes to save', life: 2000 });
    return;
  }

  let doneCount = 0;
  let successCount = 0;
  const onDone = (ok: boolean): void => {
    doneCount++;
    if (ok) successCount++;
    if (doneCount !== total) return;

    if (successCount === total) {
      messageService.add({ severity: 'success', summary: 'Saved', detail: `Saved ${total} item(s) successfully`, life: 2500 });
    } else if (successCount === 0) {
      messageService.add({ severity: 'error', summary: 'Save Failed', detail: `Failed to save ${total} item(s)`, life: 3000 });
    } else {
      messageService.add({ severity: 'warn', summary: 'Partially Saved', detail: `Saved ${successCount} of ${total} item(s), ${total - successCount} failed`, life: 3000 });
    }
  };

  for (const task of tasks) {
    task(onDone);
  }
}
