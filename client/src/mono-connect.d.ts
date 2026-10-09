declare module "@mono.co/connect.js" {
  export default class MonoConnect {
    constructor(options: { key: string; onSuccess: (payload: { code: string }) => void; onClose?: () => void; onLoad?: () => void });
    setup(): void;
    open(): void;
  }
}
