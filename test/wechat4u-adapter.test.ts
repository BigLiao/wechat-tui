import { describe, expect, it } from "vitest";
import {
  hydrateSparseGroupSender,
  isRecoverableWechat4uError,
  normalizeWechat4uMessage
} from "../src/protocol/wechat4u-adapter.js";

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
    MSGTYPE_APP: 49,
    MSGTYPE_STATUSNOTIFY: 51,
    MSGTYPE_SYSNOTICE: 9999,
    MSGTYPE_SYS: 10000,
    APPMSGTYPE_URL: 5,
    APPMSGTYPE_ATTACH: 6,
    APPMSGTYPE_READER_TYPE: 100001
  }
};

const recallXml =
  '<sysmsg type="revokemsg"><revokemsg><session>wxid_test_contact</session><oldmsgid>old-message-id</oldmsgid><msgid>message-id</msgid><replacemsg><![CDATA["Test Contact" recalled a message]]></replacemsg></revokemsg></sysmsg>';

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

  it("keeps the current user id stable when web wechat rotates self UserName", () => {
    const first = normalizeWechat4uMessage(
      {
        MsgId: "self-1",
        FromUserName: "@me-session-1",
        ToUserName: "@friend",
        MsgType: 1,
        Content: "hello",
        CreateTime: 1_700_000_000
      },
      {
        ...bot,
        user: {
          UserName: "@me-session-1",
          Uin: 123456,
          NickName: "Me"
        }
      }
    );
    const second = normalizeWechat4uMessage(
      {
        MsgId: "self-2",
        FromUserName: "@me-session-2",
        ToUserName: "@friend",
        MsgType: 1,
        Content: "hello again",
        CreateTime: 1_700_000_001
      },
      {
        ...bot,
        user: {
          UserName: "@me-session-2",
          Uin: 123456,
          NickName: "Me"
        }
      }
    );

    expect(first?.sender.id).toBe(second?.sender.id);
    expect(first?.sender.protocolId).toBe("@me-session-1");
    expect(second?.sender.protocolId).toBe("@me-session-2");
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

  it("parses shared link app messages", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "link-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 49,
        AppMsgType: 5,
        Content:
          "<msg><appmsg><title>Example title</title><des>Example description</des><type>5</type><url>https://example.com/?a=1&amp;b=2</url></appmsg></msg>",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("link");
    expect(message?.content).toContain("[link] Example title");
    expect(message?.content).toContain("Example description");
    expect(message?.content).toContain("https://example.com/?a=1&b=2");
  });

  it("parses mini program app messages", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "mini-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 49,
        AppMsgType: 33,
        Content:
          "<msg><appmsg><title>Mini title</title><des>Mini description</des><type>33</type><weappinfo><username>gh_demo</username><appid>wx123</appid><pagepath>pages/index/index.html?foo=bar</pagepath></weappinfo></appmsg></msg>",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("mini-program");
    expect(message?.content).toContain("[mini-program] Mini title");
    expect(message?.content).toContain("Mini description");
    expect(message?.content).toContain("pages/index/index.html?foo=bar");
  });

  it("parses group app messages after removing the sender prefix", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "group-link-1",
        FromUserName: "@@project",
        ToUserName: "@me",
        MsgType: 49,
        AppMsgType: 5,
        Content:
          "Alice:\n<msg><appmsg><title>Group link</title><des>Shared in group</des><type>5</type><url>https://example.com/group</url></appmsg></msg>",
        OriginalContent:
          "@alice:<br/>&lt;msg&gt;&lt;appmsg&gt;&lt;title&gt;Group link&lt;/title&gt;&lt;des&gt;Shared in group&lt;/des&gt;&lt;type&gt;5&lt;/type&gt;&lt;url&gt;https://example.com/group&lt;/url&gt;&lt;/appmsg&gt;&lt;/msg&gt;",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("link");
    expect(message?.sender.displayName).toBe("Alice");
    expect(message?.content).toContain("[link] Group link");
  });

  it("keeps location messages readable when details are stored in XML attributes", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "location-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 48,
        Content:
          '<msg><location x="22.543096" y="114.057865" scale="16" label="Shenzhen" poiname="Civic Center" /></msg>',
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("notice");
    expect(message?.content).toBe("[location] Civic Center");
  });

  it("keeps shared contact cards readable", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "card-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 42,
        Content: "",
        RecommendInfo: {
          UserName: "@card",
          NickName: "Card Friend"
        },
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("notice");
    expect(message?.content).toBe("[contact-card] Card Friend");
  });

  it("renders recalled messages from the protocol replacement text", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "recall-1",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 10002,
        Content: recallXml,
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("notice");
    expect(message?.content).toBe('"Test Contact" recalled a message');
    expect(message?.content).not.toContain("wxid_test_contact");
    expect(message?.content).not.toContain("message-id");
  });

  it("recognizes recalled payloads carried by system messages", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "recall-2",
        FromUserName: "@friend",
        ToUserName: "@me",
        MsgType: 10000,
        Content: recallXml,
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("notice");
    expect(message?.content).toBe('"Test Contact" recalled a message');
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

  it("does not display bare protocol ids for sparse group sticker senders", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "group-sticker-1",
        FromUserName: "@@project",
        ToUserName: "@me",
        ActualUserName: "@sparse-group-sender",
        MsgType: 47,
        Content: "",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("sticker");
    expect(message?.sender.protocolId).toBe("@sparse-group-sender");
    expect(message?.sender.displayName).toBe("Group member");
    expect(message?.content).toBe("[sticker]");
  });

  it("uses ActualNickName for sparse group sticker senders when available", () => {
    const message = normalizeWechat4uMessage(
      {
        MsgId: "group-sticker-2",
        FromUserName: "@@project",
        ToUserName: "@me",
        ActualUserName: "@sticker-sender",
        ActualNickName: "Sticker Sender",
        MsgType: 47,
        Content: "",
        CreateTime: 1_700_000_000
      },
      bot
    );

    expect(message?.type).toBe("sticker");
    expect(message?.sender.displayName).toBe("Sticker Sender");
    expect(message?.content).toBe("[sticker]");
  });

  it("hydrates sparse group sender names with group-scoped batch contact lookup", async () => {
    const group = {
      UserName: "@@big-group",
      NickName: "Big Group",
      EncryChatRoomId: "@@encrypted-room",
      MemberCount: 1,
      MemberList: [
        {
          UserName: "@member",
          DisplayName: "",
          NickName: ""
        }
      ]
    };
    const calls: unknown[] = [];
    const sparseBot = {
      ...bot,
      contacts: {
        "@me": bot.contacts["@me"],
        "@@big-group": group
      },
      batchGetContact: async (contacts: unknown[]) => {
        calls.push(contacts);
        return [
          {
            UserName: "@member",
            NickName: "Hydrated Member",
            DisplayName: "Hydrated Member"
          }
        ];
      }
    };
    const raw = {
      MsgId: "group-hydrate-1",
      FromUserName: "@@big-group",
      ToUserName: "@me",
      MsgType: 1,
      Content: "@member:\nhello",
      OriginalContent: "@member:<br/>hello",
      CreateTime: 1_700_000_000
    };

    const hydratedGroup = await hydrateSparseGroupSender(raw, sparseBot);
    const message = normalizeWechat4uMessage(raw, sparseBot);

    expect(hydratedGroup).toBe(group);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([
      {
        UserName: "@member",
        EncryChatRoomId: "@@encrypted-room"
      }
    ]);
    expect(message?.sender.displayName).toBe("Hydrated Member");
    expect(message?.content).toBe("hello");
    expect(sparseBot.contacts["@member" as keyof typeof sparseBot.contacts]).toBeUndefined();
  });

  it("retries sparse group sender hydration after an empty lookup result", async () => {
    const group = {
      UserName: "@@retry-group",
      NickName: "Retry Group",
      EncryChatRoomId: "@@retry-room",
      MemberCount: 1,
      MemberList: [{ UserName: "@retry-member", DisplayName: "", NickName: "" }]
    };
    let allowHydration = false;
    const sparseBot = {
      ...bot,
      contacts: {
        "@me": bot.contacts["@me"],
        "@@retry-group": group
      },
      batchGetContact: async () => {
        return allowHydration
          ? [{ UserName: "@retry-member", NickName: "Retry Member", DisplayName: "Retry Member" }]
          : [];
      }
    };
    const raw = {
      MsgId: "group-hydrate-retry",
      FromUserName: "@@retry-group",
      ToUserName: "@me",
      MsgType: 1,
      Content: "@retry-member:\nhello",
      OriginalContent: "@retry-member:<br/>hello",
      CreateTime: 1_700_000_000
    };
    const hydratedKeys = new Set<string>();
    const inFlightKeys = new Set<string>();

    expect(await hydrateSparseGroupSender(raw, sparseBot, { hydratedKeys, inFlightKeys })).toBeUndefined();
    allowHydration = true;
    expect(await hydrateSparseGroupSender(raw, sparseBot, { hydratedKeys, inFlightKeys })).toBe(group);

    const message = normalizeWechat4uMessage(raw, sparseBot);
    expect(message?.sender.displayName).toBe("Retry Member");
    expect(hydratedKeys.size).toBe(1);
    expect(inFlightKeys.size).toBe(0);
  });
});

describe("isRecoverableWechat4uError", () => {
  it("treats batch contact timeouts as recoverable", () => {
    const error = Object.assign(new Error("timeout of 60000ms exceeded"), {
      code: "ECONNABORTED",
      tips: "批量获取联系人失败",
      config: {
        url: "https://wx2.qq.com/cgi-bin/mmwebwx-bin/webwxbatchgetcontact?pass_ticket=secret"
      }
    });

    expect(isRecoverableWechat4uError(error)).toBe(true);
  });

  it("does not treat unrelated protocol errors as recoverable", () => {
    const error = Object.assign(new Error("login failed"), {
      code: "AUTH_FAILED",
      tips: "登录失败"
    });

    expect(isRecoverableWechat4uError(error)).toBe(false);
  });
});
