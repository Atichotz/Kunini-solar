import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-solar-bos-dialog',
  imports: [DialogModule, FormsModule, SelectModule],
  templateUrl: './solar-bos-dialog.component.html',
  styleUrl: './solar-bos-dialog.component.scss'
})
export class SolarBOSDialogComponent {
  @Input() visible = false;
  @Input() bosOptions: SelectOption[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();

  selectedBOS: string | null = null;
}
