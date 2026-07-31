/**
 * A `WebSocket` for tests — jsdom has none. Real object, no mocking framework: the test raises the events
 * itself (`open`, `deliver`, `close`) and reads back what the hook sent. Shared by `usePilot.test.ts` and
 * `wire.test.ts` so the two cannot disagree about what a socket does. Nothing in the app imports it.
 */
export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  /* Test-side drivers. */
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  deliver(data: unknown) {
    this.onmessage?.({ data });
  }
}
