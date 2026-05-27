import { describe, expect, it } from "vitest";
import { normalizeWechat4uMessage } from "../src/protocol/wechat4u-adapter.js";

const bot = {
  user: {
    UserName: "@me",
    NickName: "Me"
  },
  contacts: {
    "@me": {
      UserName: "@me",
      NickName: "Me"
    },
    "@friend": {
      UserName: "@friend",
      NickName: "Friend"
    },
    filehelper: {
      UserName: "filehelper",
      NickName: "File Helper"
    },
    "@alice": {
      UserName: "@alice",
      NickName: "Alice"
    },
    "@@project": {
      UserName: "@@project",
      NickName: "Project A",
      MemberCount: 1,
      MemberList: [
        {
          UserName: "@alice",
          NickName: "",
          DisplayName: "",
          getDisplayName: () => ""
        }
      ]
    }
  },
  CONF: {
    MSGTYPE_TEXT: 1,
    MSGTYPE_IMAGE: 3,
    MSGTYPE_STATUSNOTIFY: 51,
    MSGTYPE_SYSNOTICE: 9999,
    MSGTYPE_SYS: 10000
  }
};

describe("normalizeWechat4uMessage", () => {
  it("drops Web WeChat status notify messages", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "status-1",
        FromUserName: "@me",
        ToUserName: "@me",
        MsgType: 51,
        Content: "",
        StatusNotifyCode: 4,
        StatusNotifyUserName: "@friend",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message).toBeUndefined();
  });

  it("drops wechat4u filehelper heartbeat echoes", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "heartbeat-1",
        FromUserName: "@me",
        ToUserName: "filehelper",
        MsgType: 1,
        Content: "心跳：2026/5/26 15:00:00",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message).toBeUndefined();
  });

  it("keeps real image peer messages visible as placeholders", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "image-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 3,
        Content: "",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.conversation.title).toBe("Friend");
    expect(message?.sender.displayName).toBe("Friend");
    expect(message?.content).toBe("[image]");
    expect(message?.type).toBe("image");
  });

  it("keeps the same conversation id when richer contact metadata arrives later", () => {
    const sparseMessage = normalizeWechat4uMessage(
      {
        MsgId: "public-1",
        FromUserName: "@public-account",
        ToUserName: "@me",
        MsgType: 49,
        AppMsgType: 5,
        Content: "<msg />",
        CreateTime: 1_700_000_000
      },
      {
        ...bot,
        contacts: {
          ...bot.contacts,
          "@public-account": {
            UserName: "@public-account"
          }
        }
      }
    );
    const richMessage = normalizeWechat4uMessage(
      {
        MsgId: "public-2",
        FromUserName: "@public-account",
        ToUserName: "@me",
        MsgType: 49,
        AppMsgType: 5,
        Content: "<msg />",
        CreateTime: 1_700_000_000
      },
      {
        ...bot,
        contacts: {
          ...bot.contacts,
          "@public-account": {
            UserName: "@public-account",
            NickName: "Public Account"
          }
        }
      }
    );

    expect(sparseMessage?.conversation.id).toBe(richMessage?.conversation.id);
    expect(richMessage?.conversation.title).toBe("Public Account");
  });

  it("keeps unknown unsupported peer messages visible", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "unsupported-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 999,
        Content: "",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.content).toBe("[unsupported message]");
    expect(message?.type).toBe("unsupported");
  });

  it("uses group member metadata even when getDisplayName returns an empty string", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "group-1",
        FromUserName: "@@project",
        ToUserName: "@me",
        MsgType: 1,
        Content: "Alice:\nhello",
        OriginalContent: "@alice:<br/>hello",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.conversation.title).toBe("Project A");
    expect(message?.sender.displayName).toBe("Alice");
    expect(message?.content).toBe("hello");
  });

  it("uses the group message prefix as a fallback sender name", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "group-2",
        FromUserName: "@@project",
        ToUserName: "@me",
        MsgType: 1,
        Content: "Bob:\nhello",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.sender.displayName).toBe("Bob");
    expect(message?.content).toBe("hello");
  });

  it("uses the richer directory contact when the group member entry has no nickname", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "group-3",
        FromUserName: "@@project",
        ToUserName: "@me",
        MsgType: 1,
        Content: "@alice:\nhello",
        OriginalContent: "@alice:<br/>hello",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.sender.displayName).toBe("Alice");
    expect(message?.content).toBe("hello");
  });
});
