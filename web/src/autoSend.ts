/**
 * Sends dictated text by itself once it has stopped changing, so a voice command needs no Enter key.
 * (Wispr Flow types the whole phrase into the box when dictation ends; a typist's pauses are why
 * this is only switched on in Voice mode.)
 */
export class AutoSender {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private armedFor: string | null = null;
  /** the voice was talking when some of the waiting text arrived */
  private heardVoice = false;

  /**
   * `urgent` picks out text that must not wait for the delay (a spoken "stop"). While `hold` is true
   * (the page's own voice is talking, and dictation may have heard it), text is handed to `discard`
   * instead of being sent. Urgent text is always sent.
   */
  constructor(
    private send: (text: string) => void,
    private urgent: (text: string) => boolean = () => false,
    private hold: () => boolean = () => false,
    private discard: (text: string) => void = () => {},
  ) {}

  /** Call with the box's current text whenever it may have changed. */
  update(value: string, delayMs: number, enabled: boolean) {
    const text = value.trim();
    if (!enabled || !text) { this.cancel(); return; }
    if (text === this.armedFor) return;
    // checked as the text arrives and again when it would be sent: either way it may be the voice's echo
    const heard = this.heardVoice || this.hold();
    this.cancel();
    if (this.urgent(text)) { this.send(text); return; }
    this.armedFor = text;
    this.heardVoice = heard;
    this.timer = setTimeout(() => {
      const drop = this.heardVoice || this.hold();
      this.timer = null; this.armedFor = null; this.heardVoice = false;
      (drop ? this.discard : this.send)(text);
    }, delayMs);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.armedFor = null; this.heardVoice = false;
  }
}
