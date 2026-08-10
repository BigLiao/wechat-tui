export interface WechatEmoticon {
  name: string;
  text: string;
  pinyin: string;
  initials: string;
  aliases: string[];
}

type EmoticonEntry = readonly [name: string, pinyin: string, initials: string, aliases?: readonly string[]];

export const EMOTICON_GRID_COLUMNS = 7;
export const RECENT_EMOTICON_LIMIT = 7;

// Source: https://github.com/airinghost/wechat-emoji/tree/main/web.wechat.com/uncompressed
// Keep this list complete and in the same order as the current Web WeChat data set.
const WECHAT_EMOTICON_ENTRIES: EmoticonEntry[] = [
  ["微笑", "weixiao", "wx"],
  ["撇嘴", "piezui", "pz"],
  ["色", "se", "s"],
  ["发呆", "fadai", "fd"],
  ["得意", "deyi", "dy"],
  ["流泪", "liulei", "ll"],
  ["害羞", "haixiu", "hx"],
  ["闭嘴", "bizui", "bz"],
  ["睡", "shui", "s"],
  ["大哭", "daku", "dk"],
  ["尴尬", "ganga", "gg"],
  ["发怒", "fanu", "fn"],
  ["调皮", "tiaopi", "tp"],
  ["呲牙", "ciya", "cy", ["ziya"]],
  ["惊讶", "jingya", "jy"],
  ["难过", "nanguo", "ng"],
  ["囧", "jiong", "j"],
  ["抓狂", "zhuakuang", "zk"],
  ["吐", "tu", "t"],
  ["偷笑", "touxiao", "tx"],
  ["愉快", "yukuai", "yk"],
  ["白眼", "baiyan", "by"],
  ["傲慢", "aoman", "am"],
  ["困", "kun", "k"],
  ["惊恐", "jingkong", "jk"],
  ["憨笑", "hanxiao", "hx"],
  ["悠闲", "youxian", "yx"],
  ["咒骂", "zhouma", "zm"],
  ["疑问", "yiwen", "yw"],
  ["嘘", "xu", "x"],
  ["晕", "yun", "y"],
  ["衰", "shuai", "s"],
  ["骷髅", "kulou", "kl"],
  ["敲打", "qiaoda", "qd"],
  ["再见", "zaijian", "zj"],
  ["擦汗", "cahan", "ch"],
  ["抠鼻", "koubi", "kb"],
  ["鼓掌", "guzhang", "gz"],
  ["坏笑", "huaixiao", "hx"],
  ["右哼哼", "youhengheng", "yhh"],
  ["鄙视", "bishi", "bs"],
  ["委屈", "weiqu", "wq"],
  ["快哭了", "kuaikule", "kkl"],
  ["阴险", "yinxian", "yx"],
  ["亲亲", "qinqin", "qq"],
  ["可怜", "kelian", "kl"],
  ["笑脸", "xiaolian", "xl"],
  ["生病", "shengbing", "sb"],
  ["脸红", "lianhong", "lh"],
  ["破涕为笑", "potiweixiao", "ptwx"],
  ["恐惧", "kongju", "kj"],
  ["失望", "shiwang", "sw"],
  ["无语", "wuyu", "wy"],
  ["嘿哈", "heiha", "hh"],
  ["捂脸", "wulian", "wl"],
  ["奸笑", "jianxiao", "jx"],
  ["机智", "jizhi", "jz"],
  ["皱眉", "zhoumei", "zm"],
  ["耶", "ye", "y"],
  ["吃瓜", "chigua", "cg"],
  ["加油", "jiayou", "jy"],
  ["汗", "han", "h"],
  ["天啊", "tiana", "ta"],
  ["Emm", "emm", "e"],
  ["社会社会", "shehuishehui", "shsh"],
  ["旺柴", "wangchai", "wc"],
  ["好的", "haode", "hd"],
  ["打脸", "dalian", "dl"],
  ["哇", "wa", "w"],
  ["翻白眼", "fanbaiyan", "fby"],
  ["666", "666", "666", ["liuliuliu"]],
  ["让我看看", "rangwokankan", "rwkk"],
  ["叹气", "tanqi", "tq"],
  ["苦涩", "kuse", "ks"],
  ["裂开", "liekai", "lk"],
  ["嘴唇", "zuichun", "zc"],
  ["爱心", "aixin", "ax"],
  ["心碎", "xinsui", "xs"],
  ["拥抱", "yongbao", "yb"],
  ["强", "qiang", "q"],
  ["弱", "ruo", "r"],
  ["握手", "woshou", "ws"],
  ["胜利", "shengli", "sl"],
  ["抱拳", "baoquan", "bq"],
  ["勾引", "gouyin", "gy"],
  ["拳头", "quantou", "qt"],
  ["OK", "ok", "o"],
  ["合十", "heshi", "hs"],
  ["啤酒", "pijiu", "pj"],
  ["咖啡", "kafei", "kf"],
  ["蛋糕", "dangao", "dg"],
  ["玫瑰", "meigui", "mg"],
  ["凋谢", "diaoxie", "dx"],
  ["菜刀", "caidao", "cd"],
  ["炸弹", "zhadan", "zd"],
  ["便便", "bianbian", "bb", ["shit"]],
  ["月亮", "yueliang", "yl"],
  ["太阳", "taiyang", "ty"],
  ["庆祝", "qingzhu", "qz"],
  ["礼物", "liwu", "lw"],
  ["红包", "hongbao", "hb"],
  ["發", "fa", "f"],
  ["福", "fu", "f"],
  ["烟花", "yanhua", "yh"],
  ["爆竹", "baozhu", "bz"],
  ["猪头", "zhutou", "zt"],
  ["跳跳", "tiaotiao", "tt"],
  ["发抖", "fadou", "fd"],
  ["转圈", "zhuanquan", "zq"]
];

export const WECHAT_EMOTICONS: WechatEmoticon[] = WECHAT_EMOTICON_ENTRIES.map(
  ([name, pinyin, initials, aliases]) => ({
    name,
    text: `[${name}]`,
    pinyin,
    initials,
    aliases: aliases ? [...aliases] : []
  })
);

const EMOTICONS_BY_TEXT = new Map(WECHAT_EMOTICONS.map((emoticon) => [emoticon.text, emoticon]));

export function findWechatEmoticon(text: string): WechatEmoticon | undefined {
  return EMOTICONS_BY_TEXT.get(text);
}

export function filterWechatEmoticons(query: string): WechatEmoticon[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return WECHAT_EMOTICONS;
  }
  return WECHAT_EMOTICONS.filter((emoticon) => matchesEmoticon(emoticon, normalizedQuery));
}

export function filterRecentWechatEmoticons(recentTexts: string[], query: string): WechatEmoticon[] {
  const normalizedQuery = normalizeSearchText(query);
  return recentTexts
    .map((text) => findWechatEmoticon(text))
    .filter((emoticon): emoticon is WechatEmoticon => {
      if (!emoticon) {
        return false;
      }
      return !normalizedQuery || matchesEmoticon(emoticon, normalizedQuery);
    });
}

export function rememberWechatEmoticon(recentTexts: string[], text: string): string[] {
  if (!findWechatEmoticon(text)) {
    return recentTexts.slice(0, RECENT_EMOTICON_LIMIT);
  }
  return [text, ...recentTexts.filter((item) => item !== text)].slice(0, RECENT_EMOTICON_LIMIT);
}

function matchesEmoticon(emoticon: WechatEmoticon, normalizedQuery: string): boolean {
  return searchTokens(emoticon).some((token) => token.includes(normalizedQuery));
}

function searchTokens(emoticon: WechatEmoticon): string[] {
  return [
    emoticon.name,
    emoticon.text,
    emoticon.text.slice(1, -1),
    emoticon.pinyin,
    emoticon.initials,
    ...emoticon.aliases
  ].map(normalizeSearchText);
}

function normalizeSearchText(input: string): string {
  return input.trim().toLocaleLowerCase().replace(/\s+/g, "");
}
