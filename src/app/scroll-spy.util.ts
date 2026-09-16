export class ScrollSpy {
  private readonly listener: () => void;
  private suppressed = false;
  private resumeTimer?: ReturnType<typeof setTimeout>;

  /**
   * @param sectionIds - ordered list of element IDs to track
   * @param onActiveChange - called with the active section ID on each scroll
   */
  constructor(sectionIds: string[], onActiveChange: (id: string) => void) {
    this.listener = () => {
      if (this.suppressed) return;
      const midLine = window.innerHeight / 2;
      let active = sectionIds[0];
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= midLine) active = id;
      }
      onActiveChange(active);
    };
  }

  start(): void {
    window.addEventListener('scroll', this.listener, { passive: true });
    this.listener();
  }

  stop(): void {
    window.removeEventListener('scroll', this.listener);
    clearTimeout(this.resumeTimer);
  }

  // ระงับการอัปเดต active section ชั่วคราว — กันไม่ให้ scroll event ระหว่าง smooth-scroll (programmatic)
  // ไป override active section ผิดตัว เพราะ midLine heuristic ใช้ไม่ได้กับตำแหน่งที่ scrollTo() เลื่อนไปจอด (ชิดขอบบน ไม่ใช่กึ่งกลาง)
  suppress(durationMs: number): void {
    this.suppressed = true;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => (this.suppressed = false), durationMs);
  }
}
