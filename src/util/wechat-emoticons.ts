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
  ["酷", "ku", "k"],
  ["冷汗", "lenghan", "lh"],
  ["抓狂", "zhuakuang", "zk"],
  ["吐", "tu", "t"],
  ["偷笑", "touxiao", "tx"],
  ["可爱", "keai", "ka"],
  ["白眼", "baiyan", "by"],
  ["傲慢", "aoman", "am"],
  ["饥饿", "jie", "je", ["ji e", "jier"]],
  ["困", "kun", "k"],
  ["惊恐", "jingkong", "jk"],
  ["流汗", "liuhan", "lh"],
  ["憨笑", "hanxiao", "hx"],
  ["悠闲", "youxian", "yx"],
  ["奋斗", "fendou", "fd"],
  ["咒骂", "zhouma", "zm"],
  ["疑问", "yiwen", "yw"],
  ["嘘", "xu", "x"],
  ["晕", "yun", "y"],
  ["疯了", "fengle", "fl"],
  ["衰", "shuai", "s"],
  ["骷髅", "kulou", "kl"],
  ["敲打", "qiaoda", "qd"],
  ["再见", "zaijian", "zj"],
  ["擦汗", "cahan", "ch"],
  ["抠鼻", "koubi", "kb"],
  ["鼓掌", "guzhang", "gz"],
  ["坏笑", "huaixiao", "hx"],
  ["左哼哼", "zuohengheng", "zhh"],
  ["右哼哼", "youhengheng", "yhh"],
  ["哈欠", "haqian", "hq"],
  ["鄙视", "bishi", "bs"],
  ["委屈", "weiqu", "wq"],
  ["快哭了", "kuaikule", "kkl"],
  ["阴险", "yinxian", "yx"],
  ["亲亲", "qinqin", "qq"],
  ["吓", "xia", "x"],
  ["可怜", "kelian", "kl"],
  ["菜刀", "caidao", "cd"],
  ["西瓜", "xigua", "xg"],
  ["啤酒", "pijiu", "pj"],
  ["篮球", "lanqiu", "lq"],
  ["乒乓", "pingpang", "pp"],
  ["咖啡", "kafei", "kf"],
  ["饭", "fan", "f"],
  ["猪头", "zhutou", "zt"],
  ["玫瑰", "meigui", "mg"],
  ["凋谢", "diaoxie", "dx"],
  ["嘴唇", "zuichun", "zc"],
  ["爱心", "aixin", "ax"],
  ["心碎", "xinsui", "xs"],
  ["蛋糕", "dangao", "dg"],
  ["闪电", "shandian", "sd"],
  ["炸弹", "zhadan", "zd"],
  ["刀", "dao", "d"],
  ["足球", "zuqiu", "zq"],
  ["瓢虫", "piaochong", "pc"],
  ["便便", "bianbian", "bb", ["shit"]],
  ["月亮", "yueliang", "yl"],
  ["太阳", "taiyang", "ty"],
  ["礼物", "liwu", "lw"],
  ["拥抱", "yongbao", "yb"],
  ["强", "qiang", "q"],
  ["弱", "ruo", "r"],
  ["握手", "woshou", "ws"],
  ["胜利", "shengli", "sl"],
  ["抱拳", "baoquan", "bq"],
  ["勾引", "gouyin", "gy"],
  ["拳头", "quantou", "qt"],
  ["差劲", "chajin", "cj"],
  ["爱你", "aini", "an"],
  ["NO", "no", "n"],
  ["OK", "ok", "o"],
  ["爱情", "aiqing", "aq"],
  ["飞吻", "feiwen", "fw"],
  ["跳跳", "tiaotiao", "tt"],
  ["发抖", "fadou", "fd"],
  ["怄火", "ouhuo", "oh"],
  ["转圈", "zhuanquan", "zq"],
  ["磕头", "ketou", "kt"],
  ["回头", "huitou", "ht"],
  ["跳绳", "tiaosheng", "ts"],
  ["挥手", "huishou", "hs"],
  ["激动", "jidong", "jd"],
  ["街舞", "jiewu", "jw"],
  ["献吻", "xianwen", "xw"],
  ["左太极", "zuotaiji", "ztj"],
  ["右太极", "youtaiji", "ytj"],
  ["嘿哈", "heiha", "hh"],
  ["捂脸", "wulian", "wl"],
  ["奸笑", "jianxiao", "jx"],
  ["机智", "jizhi", "jz"],
  ["皱眉", "zhoumei", "zm"],
  ["耶", "ye", "y"],
  ["鬼魂", "guihun", "gh"],
  ["合十", "heshi", "hs"],
  ["强壮", "qiangzhuang", "qz"],
  ["红包", "hongbao", "hb"],
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
  ["裂开", "liekai", "lk"]
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
