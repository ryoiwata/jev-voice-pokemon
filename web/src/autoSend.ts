/**
 * Sends dictated text by itself once it has stopped changing, so a voice command needs no Enter key.
 * (Wispr Flow types the whole phrase into the box when dictation ends; a typist's pauses are why
 * this is only switched on in Voice mode.)
 */
export class AutoSender {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armedFor: string | null = null;

  constructor(private send: (text: string) => void) {}

  /** Call with the box's current text whenever it may have changed. */
  update(value: string, delayMs: number, enabled: boolean) {
    const text = value.trim();
    if (!enabled || !text) { this.cancel(); return; }
    if (text === this.armedFor) return;
    this.cancel();
    this.armedFor = text;
    this.timer = setTimeout(() => { this.timer = null; this.armedFor = null; this.send(text); }, delayMs);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.armedFor = null;
  }
}
