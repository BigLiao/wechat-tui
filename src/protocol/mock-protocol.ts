import { EventEmitter } from "node:events";
import type {
  ConnectionState,
  ContactInput,
  IncomingProtocolMessage,
  UserProfile,
  WeChatProtocol
} from "../types.js";
import { contactId, conversationFromContact, localMessageId } from "../util/ids.js";

export class MockProtocol extends EventEmitter implements WeChatProtocol {
  private readonly self: ContactInput;
  private readonly contacts: ContactInput[];
  private sessionData: unknown;

  constructor() {
    super();
    this.self = {
      id: contactId("self", ["mock-self"]),
      protocolId: "@mock-self",
      kind: "self",
      displayName: "Mock User",
      isSelf: true
    };
    this.contacts = [
      this.self,
      {
        id: contactId("private", ["boss"]),
        protocolId: "@boss",
        kind: "private",
        displayName: "Boss",
        remarkName: "Boss"
      },
      {
        id: contactId("group", ["project-a"]),
        protocolId: "@@project-a",
        kind: "group",
        displayName: "Project A"
      }
    ];
  }

  async start(sessionData?: unknown): Promise<void> {
    this.sessionData = sessionData ?? { mock: true, startedAt: Date.now() };
    this.emit("state", "waiting_scan" satisfies ConnectionState);
    this.emit("qr", {
      uuid: "mock-login",
      loginUrl: "mock://login",
      qrUrl: "mock://qrcode"
    });
    this.emit("state", "online" satisfies ConnectionState);
    this.emit("login", this.getCurrentUser());
    this.emit("contacts", this.contacts);
  }

  async reconnect(): Promise<void> {
    this.emit("state", "reconnecting" satisfies ConnectionState);
    this.emit("state", "online" satisfies ConnectionState);
  }

  async logout(): Promise<void> {
    this.emit("state", "logout" satisfies ConnectionState);
    this.emit("logout");
  }

  async sendText(toProtocolId: string, text: string): Promise<{ messageId?: string; raw?: unknown }> {
    const messageId = localMessageId(["mock-send", toProtocolId, text, String(Date.now())]);
    return { messageId, raw: { ok: true } };
  }

  async getContacts(): Promise<ContactInput[]> {
    return this.contacts;
  }

  getCurrentUser(): UserProfile {
    return {
      id: this.self.id,
      protocolId: this.self.protocolId,
      displayName: this.self.displayName
    };
  }

  getSessionData(): unknown | undefined {
    return this.sessionData;
  }

  emitIncoming(contactName: string, content: string, timestamp = Date.now()): void {
    const contact = this.contacts.find((item) => item.displayName === contactName || item.remarkName === contactName);
    if (!contact) {
      throw new Error(`Unknown mock contact ${contactName}`);
    }
    const conversation = conversationFromContact(contact);
    const sender = contact.kind === "group" ? { ...contact, displayName: "Mock Member" } : contact;
    const message: IncomingProtocolMessage = {
      id: localMessageId([conversation.id, sender.id, content, String(timestamp)]),
      conversation,
      sender,
      isSelf: false,
      content,
      type: "text",
      timestamp
    };
    this.emit("message", message);
  }
}
