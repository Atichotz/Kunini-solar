import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-solar-installation-dialog',
  imports: [DialogModule, FormsModule, SelectModule],
  templateUrl: './solar-installation-dialog.component.html',
  styleUrl: './solar-installation-dialog.component.scss'
})
export class SolarInstallationDialogComponent {
  @Input() visible = false;
  @Input() installationTypeOptions: SelectOption[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();

  selectedInstallationType: string | null = null;
}
