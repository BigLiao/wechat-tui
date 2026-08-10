import { describe, expect, it } from "vitest";
import { filterWechatEmoticons, WECHAT_EMOTICONS } from "../src/util/wechat-emoticons.js";

const LATEST_WECHAT_EMOTICON_NAMES = [
  "微笑", "撇嘴", "色", "发呆", "得意", "流泪", "害羞", "闭嘴", "睡", "大哭",
  "尴尬", "发怒", "调皮", "呲牙", "惊讶", "难过", "囧", "抓狂", "吐", "偷笑",
  "愉快", "白眼", "傲慢", "困", "惊恐", "憨笑", "悠闲", "咒骂", "疑问", "嘘",
  "晕", "衰", "骷髅", "敲打", "再见", "擦汗", "抠鼻", "鼓掌", "坏笑", "右哼哼",
  "鄙视", "委屈", "快哭了", "阴险", "亲亲", "可怜", "笑脸", "生病", "脸红", "破涕为笑",
  "恐惧", "失望", "无语", "嘿哈", "捂脸", "奸笑", "机智", "皱眉", "耶", "吃瓜",
  "加油", "汗", "天啊", "Emm", "社会社会", "旺柴", "好的", "打脸", "哇", "翻白眼",
  "666", "让我看看", "叹气", "苦涩", "裂开", "嘴唇", "爱心", "心碎", "拥抱", "强",
  "弱", "握手", "胜利", "抱拳", "勾引", "拳头", "OK", "合十", "啤酒", "咖啡",
  "蛋糕", "玫瑰", "凋谢", "菜刀", "炸弹", "便便", "月亮", "太阳", "庆祝", "礼物",
  "红包", "發", "福", "烟花", "爆竹", "猪头", "跳跳", "发抖", "转圈"
] as const;

describe("WeChat emoticons", () => {
  it("matches the complete current Web WeChat emoticon list", () => {
    expect(WECHAT_EMOTICONS.map((emoticon) => emoticon.name)).toEqual(LATEST_WECHAT_EMOTICON_NAMES);
    expect(WECHAT_EMOTICONS.map((emoticon) => emoticon.text)).toEqual(
      LATEST_WECHAT_EMOTICON_NAMES.map((name) => `[${name}]`)
    );
  });

  it("uses the WeChat joyful label instead of the QQ cute label", () => {
    expect(filterWechatEmoticons("yukuai").map((emoticon) => emoticon.text)).toContain("[愉快]");
    expect(WECHAT_EMOTICONS.map((emoticon) => emoticon.text)).not.toContain("[可爱]");
  });
});
