import type { EventEmitter } from "node:events";

export type ConnectionState =
  | "init"
  | "waiting_scan"
  | "waiting_confirm"
  | "online"
  | "syncing"
  | "idle"
  | "reconnecting"
  | "offline"
  | "logout"
  | "error";

export type AppView = "startup" | "login" | "chats" | "chat" | "search";
export type ConversationFocus = "list" | "input";
export type ContactKind = "private" | "group" | "public" | "special" | "self";
export type MessageKind =
  | "text"
  | "notice"
  | "link"
  | "image"
  | "voice"
  | "video"
  | "file"
  | "mini-program"
  | "sticker"
  | "unsupported";

export interface ContactRecord {
  id: string;
  protocolId?: string;
  kind: ContactKind;
  displayName: string;
  remarkName?: string;
  nickName?: string;
  alias?: string;
  isSelf: boolean;
  raw?: unknown;
  updatedAt: number;
}

export interface ContactInput {
  id: string;
  protocolId?: string;
  kind: ContactKind;
  displayName: string;
  remarkName?: string;
  nickName?: string;
  alias?: string;
  isSelf?: boolean;
  raw?: unknown;
}

export interface ConversationRecord {
  id: string;
  protocolId?: string;
  kind: ContactKind;
  title: string;
  unreadCount: number;
  lastMessagePreview?: string;
  lastMessageSenderName?: string;
  lastMessageIsSelf?: boolean;
  lastMessageAt?: number;
  updatedAt: number;
}

export interface ConversationInput {
  id: string;
  protocolId?: string;
  kind: ContactKind;
  title: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  protocolMessageId?: string;
  senderId?: string;
  senderKind?: MessageSenderKind;
  senderProtocolId?: string;
  senderName: string;
  isSelf: boolean;
  content: string;
  type: MessageKind;
  timestamp: number;
  raw?: unknown;
  createdAt: number;
}

export interface MessageInput {
  id: string;
  conversationId: string;
  protocolMessageId?: string;
  senderId?: string;
  senderKind?: MessageSenderKind;
  senderProtocolId?: string;
  senderName: string;
  isSelf: boolean;
  content: string;
  type: MessageKind;
  timestamp: number;
  raw?: unknown;
}

export interface ProtocolQrEvent {
  uuid: string;
  loginUrl: string;
  qrUrl: string;
}

export interface UserProfile {
  id: string;
  protocolId?: string;
  displayName: string;
  raw?: unknown;
}

export interface IncomingProtocolMessage {
  id: string;
  protocolMessageId?: string;
  conversation: ConversationInput;
  sender: ContactInput;
  isSelf: boolean;
  content: string;
  type: MessageKind;
  timestamp: number;
  raw?: unknown;
}

export type MessageSenderKind = "self" | "contact" | "group-member" | "unknown";

export interface GroupMemberRecord {
  id: string;
  groupId: string;
  groupProtocolId?: string;
  memberProtocolId: string;
  displayName: string;
  remarkName?: string;
  nickName?: string;
  alias?: string;
  raw?: unknown;
  updatedAt: number;
}

export interface GroupMemberInput {
  id: string;
  groupId: string;
  groupProtocolId?: string;
  memberProtocolId: string;
  displayName: string;
  remarkName?: string;
  nickName?: string;
  alias?: string;
  raw?: unknown;
}

export interface UpdateInfo {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
  installCommand: string;
}

export interface MediaDownloadResult {
  data: Buffer;
  contentType: string;
}

export interface WeChatProtocol extends EventEmitter {
  start(sessionData?: unknown): Promise<void>;
  reconnect(): Promise<void>;
  logout(): Promise<void>;
  sendText(toProtocolId: string, text: string): Promise<{ messageId?: string; raw?: unknown }>;
  sendFile(toProtocolId: string, filePath: string): Promise<{ messageId?: string; raw?: unknown }>;
  downloadMedia(message: IncomingProtocolMessage): Promise<MediaDownloadResult | undefined>;
  getContacts(): Promise<ContactInput[]>;
  getCurrentUser(): UserProfile | undefined;
  getSessionData(): unknown | undefined;

  on(event: "qr", listener: (event: ProtocolQrEvent) => void): this;
  on(event: "scan", listener: () => void): this;
  on(event: "login", listener: (user: UserProfile) => void): this;
  on(event: "logout", listener: () => void): this;
  on(event: "contacts", listener: (contacts: ContactInput[]) => void): this;
  on(event: "message", listener: (message: IncomingProtocolMessage) => void): this;
  on(event: "state", listener: (state: ConnectionState) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface UiKey {
  sequence: string;
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
}

export type UiEvent =
  | { type: "key"; key: UiKey }
  | { type: "conversation-select"; index: number }
  | { type: "conversation-open"; conversationId?: string }
  | { type: "chat-change"; text: string }
  | { type: "chat-submit"; text: string }
  | { type: "file-submit"; filePath: string };

export interface RenderState {
  view: AppView;
  previousView?: AppView;
  connectionState: ConnectionState;
  accountName?: string;
  qr?: ProtocolQrEvent;
  statusMessage?: string;
  errorMessage?: string;
  debugLogPath?: string;
  updateInfo?: UpdateInfo;
  startupFrame?: number;
  startupMessage?: string;
  conversations: ConversationRecord[];
  conversationQuery: string;
  selectedConversationIndex: number;
  conversationFocus: ConversationFocus;
  activeConversation?: ConversationRecord;
  messages: MessageRecord[];
  searchKeyword: string;
  searchResults: ContactRecord[];
  selectedSearchIndex: number;
  chatInput: string;
  messageScrollOffset: number;
  commandInput: string;
  totalUnreadCount: number;
  unreadConversations: ConversationRecord[];
  switcherConversations: ConversationRecord[];
  conversationSwitcherActive: boolean;
  selectedSwitcherConversationId?: string;
}

export interface WorkbenchRenderer {
  start(onEvent: (event: UiEvent) => void, onClose: () => void): void;
  stop(): void;
  render(state: RenderState): void;
  setFileRegistry?(registry: unknown): void;
}

export interface SearchResult {
  conversation: ConversationRecord;
  message: MessageRecord;
}

export interface MessageStore {
  close(): Promise<void>;
  setActiveAccount(account: UserProfile): Promise<void>;
  clearActiveAccount(): void;
  getSessionData(): Promise<unknown | undefined>;
  setSessionData(data: unknown): Promise<void>;
  clearSessionData(): Promise<void>;
  clearData(): Promise<void>;
  upsertContact(contact: ContactInput): Promise<ContactRecord>;
  upsertContacts(contacts: ContactInput[]): Promise<ContactRecord[]>;
  upsertGroupMember(member: GroupMemberInput): Promise<GroupMemberRecord>;
  markAllContactsStale(): Promise<void>;
  listContacts(kind?: ContactKind, limit?: number): Promise<ContactRecord[]>;
  findContactByName(query: string): Promise<ContactRecord | undefined>;
  searchContacts(keyword: string, limit?: number): Promise<ContactRecord[]>;
  upsertConversation(conversation: ConversationInput): Promise<ConversationRecord>;
  mergeStaleConversationForContact(contact: ContactRecord, conversation: ConversationRecord): Promise<ConversationRecord>;
  findConversationById(id: string): Promise<ConversationRecord | undefined>;
  hasMessage(messageId: string): Promise<boolean>;
  saveMessage(message: MessageInput, conversation: ConversationInput, incrementUnread: boolean): Promise<MessageRecord>;
  updateMessageRaw(messageId: string, raw: unknown): Promise<void>;
  listRecentConversations(limit?: number): Promise<ConversationRecord[]>;
  listUnreadConversations(limit?: number): Promise<ConversationRecord[]>;
  listMessages(conversationId: string, limit?: number): Promise<MessageRecord[]>;
  searchMessages(keyword: string, limit?: number, conversationId?: string): Promise<SearchResult[]>;
  markRead(conversationId: string): Promise<void>;
  totalUnreadCount(): Promise<number>;
}
