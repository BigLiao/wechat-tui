declare module "qrcode-terminal" {
  export interface GenerateOptions {
    small?: boolean;
  }

  export function generate(input: string, options?: GenerateOptions, callback?: (qr: string) => void): void;

  const qrcode: {
    generate: typeof generate;
  };

  export default qrcode;
}

declare module "wechat4u" {
  const Wechat: new (botData?: unknown) => unknown;
  export default Wechat;
}
