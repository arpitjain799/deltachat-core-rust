import * as T from "../generated/types.js";
import * as RPC from "../generated/jsonrpc.js";
import { RawClient } from "../generated/client.js";
import { WebsocketTransport, BaseTransport, Request } from "yerpc";
import { TinyEmitter } from "@deltachat/tiny-emitter";

type DCWireEvent<T extends Event> = {
  event: T;
  contextId: number;
};
// export type Events = Record<
//   Event["type"] | "ALL",
//   (event: DeltaChatEvent<Event>) => void
// >;

type Events = { ALL: (accountId: number, event: Event) => void } & {
  [Property in Event["type"]]: (
    accountId: number,
    event: Extract<Event, { type: Property }>
  ) => void;
};

type ContextEvents = { ALL: (event: Event) => void } & {
  [Property in Event["type"]]: (
    event: Extract<Event, { type: Property }>
  ) => void;
};

export type DcEvent = Event;
export type DcEventType<T extends Event["type"]> = Extract<Event, { type: T }>;

export class BaseDeltaChat<
  Transport extends BaseTransport<any>
> extends TinyEmitter<Events> {
  rpc: RawClient;
  account?: T.Account;
  private contextEmitters: { [key: number]: TinyEmitter<ContextEvents> } = {};

  //@ts-ignore
  private eventTask: Promise<void>;

  constructor(public transport: Transport, startEventLoop: boolean) {
    super();
    this.rpc = new RawClient(this.transport);
    if (startEventLoop) {
      this.eventTask = this.eventLoop();
    }
  }

  async eventLoop(): Promise<void> {
    while (true) {
      const event = await this.rpc.getNextEvent();
      this.emit(event.event.type, event.context_id, event.event as any);
      this.emit("ALL", event.context_id, event.event as any);

      if (this.contextEmitters[event.context_id]) {
        this.contextEmitters[event.context_id].emit(
          event.event.type,
          //@ts-ignore
          event.event as any
        );
        this.contextEmitters[event.context_id].emit("ALL", event.event as any);
      }
    }
  }

  async listAccounts(): Promise<T.Account[]> {
    return await this.rpc.getAllAccounts();
  }

  getContextEvents(account_id: number) {
    if (this.contextEmitters[account_id]) {
      return this.contextEmitters[account_id];
    } else {
      this.contextEmitters[account_id] = new TinyEmitter();
      return this.contextEmitters[account_id];
    }
  }
}

export type Opts = {
  url: string;
  startEventLoop: boolean;
};

export const DEFAULT_OPTS: Opts = {
  url: "ws://localhost:20808/ws",
  startEventLoop: true,
};
export class DeltaChat extends BaseDeltaChat<WebsocketTransport> {
  opts: Opts;
  close() {
    this.transport.close();
  }
  constructor(opts?: Opts | string) {
    if (typeof opts === "string") {
      opts = { ...DEFAULT_OPTS, url: opts };
    } else if (opts) {
      opts = { ...DEFAULT_OPTS, ...opts };
    } else {
      opts = { ...DEFAULT_OPTS };
    }
    const transport = new WebsocketTransport(opts.url);
    super(transport, opts.startEventLoop);
    this.opts = opts;
  }
}

export class StdioDeltaChat extends BaseDeltaChat<StdioTransport> {
  close() {}
  constructor(input: any, output: any, startEventLoop: boolean) {
    const transport = new StdioTransport(input, output);
    super(transport, startEventLoop);
  }
}

export class StdioTransport extends BaseTransport {
  constructor(public input: any, public output: any) {
    super();

    var buffer = "";
    this.output.on("data", (data: any) => {
      buffer += data.toString();
      while (buffer.includes("\n")) {
        const n = buffer.indexOf("\n");
        const line = buffer.substring(0, n);
        const message = JSON.parse(line);
        this._onmessage(message);
        buffer = buffer.substring(n + 1);
      }
    });
  }

  _send(message: any): void {
    const serialized = JSON.stringify(message);
    this.input.write(serialized + "\n");
  }
}
