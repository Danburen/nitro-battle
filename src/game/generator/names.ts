import { Biome } from "../../terrain/biome.ts";
import { LCGRandom } from "../../utils/LCGRandom.ts";

/** Terrain families used to pick style-matching suffixes. */
export type TerrainClass =
    | "plain" | "forest" | "hill" | "mountain" | "desert"
    | "marsh" | "tundra" | "coast" | "ice" | "bare" | "water";

export const TERRAIN_CLASSES: readonly TerrainClass[] = [
    "plain", "forest", "hill", "mountain", "desert",
    "marsh", "tundra", "coast", "ice", "bare", "water",
];

export function terrainClassOf(biome: number): TerrainClass {
    switch (biome) {
        case Biome.FOREST: return "forest";
        case Biome.HILLS: return "hill";
        case Biome.MOUNTAINS: return "mountain";
        case Biome.DESERT: return "desert";
        case Biome.MARSH: return "marsh";
        case Biome.TUNDRA: return "tundra";
        case Biome.BEACH: return "coast";
        case Biome.ICE: return "ice";
        case Biome.BARE: return "bare";
        case Biome.OCEAN:
        case Biome.LAKE: return "water";
        default: return "plain";
    }
}

interface Culture {
    readonly name: string;
    readonly prefixes: readonly string[];
    readonly roots: readonly string[];
    readonly suffixes: Readonly<Record<TerrainClass, readonly string[]>>;
    /** Place-name samples training the culture's 2nd-order Markov fallback. */
    readonly samples: readonly string[];
}

export const CULTURES: readonly Culture[] = [
    {
        name: "华夏",
        prefixes: ["云", "青", "苍", "白", "赤", "金", "玉", "龙", "凤", "临", "安", "宁", "武", "昌", "景", "昭"],
        roots: ["阳", "陵", "川", "源", "丰", "乐", "寿", "和", "兴", "广", "德", "清", "明", "平", "定", "远"],
        suffixes: {
            plain: ["原", "川", "野", "坪"],
            forest: ["林", "森", "榕", "麓"],
            hill: ["丘", "岗", "坡", "岭"],
            mountain: ["山", "岳", "峰", "岭"],
            desert: ["沙", "碛", "漠", "戈壁"],
            marsh: ["泽", "淀", "洼", "塘"],
            tundra: ["甸", "荒", "原", "野"],
            coast: ["湾", "浦", "津", "港"],
            ice: ["雪", "冰", "寒", "凌"],
            bare: ["石", "岩", "砾", "崖"],
            water: ["湖", "泊", "潭", "渊"],
        },
        samples: [
            "杭州", "苏州", "洛阳", "长安", "金陵", "成都", "临安", "汴梁", "幽州", "冀州",
            "青州", "徐州", "扬州", "荆州", "梁州", "雍州", "豫州", "兖州", "云梦", "彭蠡",
            "洞庭", "太湖", "巢湖", "洪泽", "鄱阳", "昆仑", "天山", "祁连", "秦岭", "太行",
            "王屋", "终南", "峨嵋", "青城", "武当", "龙虎", "雁荡", "普陀", "井冈", "六盘",
            "贺兰", "阴山", "燕山", "泰山", "华山", "衡山", "恒山", "嵩山", "黄山", "庐山",
            "雁门", "剑门", "潼关", "函谷", "阳关", "玉门", "居延", "轮台", "伊犁", "楼兰",
            "龟兹", "于阗", "疏勒", "焉耆", "姑臧", "敦煌", "张掖", "酒泉", "武威", "金城",
            "天水", "安定", "北地", "朔方", "五原", "云中", "代郡", "上谷", "渔阳", "辽西",
        ],
    },
    {
        name: "欧陆",
        prefixes: ["诺", "瓦", "奥", "瑞", "卡", "塞", "维", "德", "莫", "伊", "洛", "布", "兰", "克", "图", "恩", "萨", "哈尔"],
        roots: ["尔", "斯", "特", "姆", "纳", "里", "顿", "格", "夫", "曼", "丁", "茨", "堡", "登"],
        suffixes: {
            plain: ["平原", "尼亚", "兰", "顿"],
            forest: ["伍德", "海姆", "瓦尔德", "林"],
            hill: ["高地", "伯格", "赫姆", "丘陵"],
            mountain: ["山口", "塔尔", "峰", "岭"],
            desert: ["斯坦", "卡尔", "沙地", "荒漠"],
            marsh: ["布鲁克", "摩尔", "沼泽", "湿地"],
            tundra: ["诺德", "维克", "荒原", "冻土"],
            coast: ["湾", "港", "维克", "海滩"],
            ice: ["弗罗斯", "加德", "冰原", "雪原"],
            bare: ["费尔斯", "斯坦", "岩地", "石原"],
            water: ["湖", "米尔", "泊", "尼亚"],
        },
        samples: [
            "诺夫哥罗德", "斯德哥尔摩", "奥斯陆", "赫尔辛基", "哥本哈根", "汉堡", "慕尼黑", "科隆",
            "法兰克福", "斯图加特", "纽伦堡", "莱比锡", "德累斯顿", "布拉格", "维也纳", "萨尔茨堡",
            "因斯布鲁克", "苏黎世", "日内瓦", "伯尔尼", "洛桑", "米兰", "都灵", "热那亚",
            "威尼斯", "佛罗伦萨", "罗马", "那不勒斯", "巴黎", "里昂", "马赛", "波尔多",
            "图卢兹", "尼斯", "南特", "布鲁塞尔", "安特卫普", "阿姆斯特丹", "鹿特丹", "伦敦",
            "约克", "利物浦", "曼彻斯特", "伯明翰", "爱丁堡", "格拉斯哥", "都柏林", "马德里",
            "巴塞罗那", "瓦伦西亚", "塞维利亚", "里斯本", "波尔图", "华沙", "克拉科夫", "格但斯克",
            "布达佩斯", "贝尔格莱德", "萨格勒布", "布加勒斯特", "索非亚", "雅典", "基辅", "敖德萨",
            "明斯克", "维尔纽斯", "里加", "塔林", "莫斯科", "喀山", "叶卡捷琳堡", "新西伯利亚",
            "鄂木斯克", "托木斯克", "伊尔库茨克", "摩尔曼斯克", "沃洛格达", "特维尔", "斯摩棱斯克", "库尔斯克",
        ],
    },
    {
        name: "草原",
        prefixes: ["乌兰", "巴音", "呼和", "呼伦", "贝尔", "阿尔", "博尔", "格尔", "赤", "泰", "呼和", "锡林"],
        roots: ["巴", "图", "格", "勒", "沁", "泰", "罕", "拉", "沁", "布"],
        suffixes: {
            plain: ["草原", "浩特", "郭勒", "塔拉"],
            forest: ["希勒", "乌拉", "林", "林海"],
            hill: ["丘陵", "敖包", "岗", "梁"],
            mountain: ["乌拉", "达坂", "山", "敖包"],
            desert: ["戈壁", "沙地", "库姆", "荒漠"],
            marsh: ["淖尔", "湿地", "沼泽", "塔拉"],
            tundra: ["荒原", "冻土", "库伦", "戈壁"],
            coast: ["诺尔", "湾", "淖尔", "港"],
            ice: ["雪原", "冰达坂", "寒岭", "冻原"],
            bare: ["石原", "岩地", "砾漠", "黑山"],
            water: ["诺尔", "淖尔", "湖", "泊"],
        },
        samples: [
            "乌兰巴托", "呼和浩特", "包头", "赤峰", "通辽", "呼伦贝尔", "满洲里", "二连浩特",
            "锡林浩特", "乌兰浩特", "阿尔山", "巴彦淖尔", "鄂尔多斯", "乌兰察布", "阿拉善", "额济纳",
            "巴音郭楞", "博尔塔拉", "伊犁", "克孜勒苏", "喀什", "和田", "阿克苏", "库车",
            "轮台", "库尔勒", "吐鲁番", "哈密", "敦煌", "酒泉", "张掖", "武威",
            "兰州", "西宁", "格尔木", "德令哈", "玉树", "果洛", "海北", "海西",
            "柴达木", "可可西里", "唐古拉", "巴颜喀拉", "阿尼玛卿", "祁连", "门源", "互助",
            "湟中", "乐都", "民和", "化隆", "循化", "贵德", "同德", "兴海",
            "玛多", "玛沁", "甘德", "达日", "班玛", "久治", "泽库", "尖扎",
            "同仁", "夏河", "碌曲", "玛曲", "迭部", "舟曲", "卓尼", "临潭",
            "合作", "临夏", "东乡", "积石山", "广河", "康乐", "和政", "永靖",
        ],
    },
    {
        name: "海洋",
        prefixes: ["阿", "贝", "卡", "达", "埃", "法", "格", "哈", "伊", "雅", "科", "拉", "玛", "纳", "奥", "帕"],
        roots: ["尔", "拉", "斯", "纳", "维", "京", "顿", "姆", "鲁", "瓦"],
        suffixes: {
            plain: ["岛", "沙洲", "环礁", "平原"],
            forest: ["椰林", "雨林", "绿岛", "林"],
            hill: ["丘", "岗", "高地", "坡"],
            mountain: ["火山", "峰", "脊", "崖"],
            desert: ["沙岛", "干礁", "荒滩", "碛"],
            marsh: ["泻湖", "沼泽", "红林", "滩"],
            tundra: ["寒岛", "冻原", "荒滩", "冰碛"],
            coast: ["湾", "峡", "港", "礁"],
            ice: ["冰湾", "寒礁", "雪岛", "冻港"],
            bare: ["岩礁", "石岛", "砾滩", "黑崖"],
            water: ["环礁", "泻湖", "海", "洋"],
        },
        samples: [
            "檀香山", "希洛", "凯卢阿", "珍珠港", "瓦胡", "考艾", "毛伊", "拉奈",
            "莫洛凯", "尼豪", "中途岛", "威克", "关岛", "塞班", "天宁", "罗塔",
            "帕劳", "科罗尔", "贝里琉", "雅浦", "丘克", "波纳佩", "科斯雷", "马朱罗",
            "夸贾林", "埃尼威托克", "比基尼", "朗格拉普", "沃杰", "奥尔", "乌贾埃", "埃邦",
            "贾卢伊特", "米利", "阿尔诺", "梅吉特", "乌杰朗", "塔翁吉", "苏瓦", "楠迪",
            "劳托卡", "拉巴萨", "瓦努阿", "塔韦乌尼", "坎达武", "努库阿洛法", "哈派", "瓦瓦乌",
            "埃瓦", "纽阿斯", "托富阿", "阿皮亚", "帕果帕果", "图图伊拉", "乌波卢", "萨瓦伊",
            "阿瓦鲁阿", "拉罗汤加", "艾图塔基", "曼加伊亚", "阿蒂乌", "米蒂亚罗", "普卡普卡", "拿骚",
            "马尼希基", "拉卡杭阿", "苏瓦罗", "彭林", "阿洛菲", "法考福", "努库诺努", "阿塔富",
            "富纳富提", "瓦伊图普", "努库费陶", "纳诺梅阿", "纳努芒阿", "纽陶", "塔拉瓦", "拜里基",
        ],
    },
];

/** Characters that tie a name to a terrain family; used to filter Markov draws. */
const TERRAIN_HINTS: Readonly<Record<TerrainClass, readonly string[]>> = {
    plain: ["原", "川", "野", "坪", "平原", "草原", "塔拉"],
    forest: ["林", "森", "榕", "麓", "伍德", "海姆"],
    hill: ["丘", "岗", "坡", "高地", "伯格"],
    mountain: ["山", "岭", "峰", "岳", "崖", "达坂", "乌拉", "塔尔"],
    desert: ["沙", "碛", "漠", "戈壁", "斯坦", "库姆"],
    marsh: ["泽", "淀", "洼", "塘", "沼泽", "湿地", "摩尔"],
    tundra: ["甸", "荒", "冻", "诺德", "库伦"],
    coast: ["湾", "浦", "津", "港", "峡", "礁", "滩"],
    ice: ["雪", "冰", "寒", "凌", "弗罗斯"],
    bare: ["石", "岩", "砾", "费尔斯"],
    water: ["湖", "泊", "潭", "渊", "诺尔", "淖尔", "海", "洋", "泻湖"],
};

const BLACKLIST = new Set([
    "北京", "南京", "东京", "上海", "天津", "重庆", "台北", "首尔", "平壤",
    "莫斯科", "伦敦", "巴黎", "柏林", "罗马", "华盛顿", "帝国", "共和国", "联邦",
    "政府", "总统", "主席", "纳粹", "法西斯",
]);

const NAME_MIN = 2;
const NAME_MAX = 5;
const TEMPLATE_ATTEMPTS = 24;
const POOL_SIZE = 64;
const POOL_REBUILDS = 6;

interface MarkovModel {
    starts: string[];
    chain: Map<string, string[]>;
}

/** 2nd-order character n-gram over a culture's place-name samples. */
function trainMarkov(samples: readonly string[]): MarkovModel {
    const chain = new Map<string, string[]>();
    const starts: string[] = [];
    for (const sample of samples) {
        const seq = ["^", "^", ...[...sample], "$"];
        for (let i = 2; i < seq.length; i++) {
            const key = seq[i - 2] + seq[i - 1];
            const list = chain.get(key) ?? [];
            list.push(seq[i]);
            chain.set(key, list);
            if (seq[i - 2] === "^") starts.push(key);
        }
    }
    return { starts, chain };
}

function markovDraw(model: MarkovModel, rand: LCGRandom, maxLen: number): string | null {
    let key = "^^";
    let out = "";
    while (out.length < maxLen) {
        const options = model.chain.get(key);
        if (!options || options.length === 0) return null;
        const next = options[rand.nextInt(0, options.length)];
        if (next === "$") break;
        out += next;
        key = key.slice(1) + next;
    }
    return out.length >= NAME_MIN ? out : null;
}

function terrainAffinity(name: string, terrain: TerrainClass): boolean {
    const hints = TERRAIN_HINTS[terrain];
    if (hints.some((hint) => name.includes(hint))) return true;
    for (const other of TERRAIN_CLASSES) {
        if (other === terrain) continue;
        if (TERRAIN_HINTS[other].some((hint) => name.includes(hint))) return false;
    }
    return true;
}

/**
 * Place-name pipeline: culture/terrain templates first, a per-culture Markov
 * pool as fallback, then length / blacklist / global-dedup post-processing.
 */
export class NameGenerator {
    private readonly rand: LCGRandom;
    private readonly used = new Set<string>();
    private readonly models = new Map<number, MarkovModel>();
    private readonly pools = new Map<string, string[]>();

    constructor(rand: LCGRandom) {
        this.rand = rand;
    }

    provinceName(culture: number, terrain: TerrainClass): string {
        return this.generate(culture, terrain, NAME_MIN, NAME_MAX, "");
    }

    regionName(culture: number, terrain: TerrainClass): string {
        return this.generate(culture, terrain, NAME_MIN, NAME_MAX - 1, "州");
    }

    private generate(culture: number, terrain: TerrainClass, min: number, max: number, tail: string): string {
        const cultureDef = CULTURES[culture];
        for (let attempt = 0; attempt < TEMPLATE_ATTEMPTS; attempt++) {
            const base =
                cultureDef.prefixes[this.rand.nextInt(0, cultureDef.prefixes.length)] +
                cultureDef.roots[this.rand.nextInt(0, cultureDef.roots.length)] +
                (tail === "" ? cultureDef.suffixes[terrain][this.rand.nextInt(0, cultureDef.suffixes[terrain].length)] : "");
            if (this.accept(base + tail, min + tail.length, max + tail.length)) return base + tail;
        }

        for (let rebuild = 0; rebuild <= POOL_REBUILDS; rebuild++) {
            const pool = this.poolFor(culture, terrain, min, max);
            while (pool.length > 0) {
                const base = pool.shift() as string;
                if (this.accept(base + tail, min + tail.length, max + tail.length)) return base + tail;
            }
            this.pools.delete(this.poolKey(culture, terrain, min, max));
        }

        // Terrain-neutral bare roots, then unfiltered Markov draws.
        for (let attempt = 0; attempt < TEMPLATE_ATTEMPTS; attempt++) {
            const base =
                cultureDef.prefixes[this.rand.nextInt(0, cultureDef.prefixes.length)] +
                cultureDef.roots[this.rand.nextInt(0, cultureDef.roots.length)];
            if (this.accept(base + tail, min + tail.length, max + tail.length)) return base + tail;
        }
        const model = this.models.get(culture);
        if (model) {
            for (let attempt = 0; attempt < POOL_SIZE; attempt++) {
                const base = markovDraw(model, this.rand, max);
                if (base !== null && this.accept(base + tail, min + tail.length, max + tail.length)) return base + tail;
            }
        }

        const fallback = `边区${this.used.size + 1}`;
        this.used.add(fallback);
        return fallback;
    }

    private accept(name: string, min: number, max: number): boolean {
        const length = [...name].length;
        if (length < min || length > max) return false;
        if (BLACKLIST.has(name) || this.used.has(name)) return false;
        this.used.add(name);
        return true;
    }

    private poolKey(culture: number, terrain: TerrainClass, min: number, max: number): string {
        return `${culture}:${terrain}:${min}:${max}`;
    }

    private poolFor(culture: number, terrain: TerrainClass, min: number, max: number): string[] {
        const key = this.poolKey(culture, terrain, min, max);
        const existing = this.pools.get(key);
        if (existing) return existing;

        let model = this.models.get(culture);
        if (!model) {
            model = trainMarkov(CULTURES[culture].samples);
            this.models.set(culture, model);
        }
        const pool: string[] = [];
        const seen = new Set<string>();
        for (let attempt = 0; attempt < POOL_SIZE * 12 && pool.length < POOL_SIZE; attempt++) {
            const name = markovDraw(model, this.rand, max);
            if (name === null || seen.has(name)) continue;
            seen.add(name);
            if (!terrainAffinity(name, terrain)) continue;
            pool.push(name);
        }
        this.pools.set(key, pool);
        return pool;
    }
}