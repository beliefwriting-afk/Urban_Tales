#!/usr/bin/env node
/**
 * 建置期內容驗證 —— SDD §2.4 的十項 ＋ #3b／#7b，外加隱私與範本金鑰掃描。
 *
 * 在 CI 與 prebuild 執行，★ 驗不過就不給部署 ★。
 *
 * 設計原則：把內容治理規則變成建置錯誤。
 * 「記得要審」是紀律問題，會失效；「不過就不能部署」是機械問題，不會。
 *
 * 跑法：npm run content:check
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
	SiteSchema,
	SoulSchema,
	MaterialSchema,
	GuidedPromptSchema,
	FallbackSchema,
	CardsFileSchema,
	GuardrailsSchema,
	FORBIDDEN_PERSONA_PHRASES
} from '../content/schema.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CONTENT = join(ROOT, 'content');
const SITES_DIR = join(CONTENT, 'sites');

/**
 * 六站全部可遊玩時，卡片總數檢查（#7）自動啟用。見下方 #7 的說明。
 *
 * ★ 卡片數是站數推導出來的：每站一張相遇卡、一張任務卡，加上萬華三站的劇情卡。
 *   改站數就要改這裡（企劃書 §5.6、§6.1）。
 */
const EXPECTED_SITE_COUNT = 6;
const EXPECTED_CARDS = { total: 15, encounter: 6, task: 6, story: 3 } as const;

// ─── 收集器 ──────────────────────────────────────────────────

const errors: string[] = [];
const warnings: string[] = [];
const notes: string[] = [];

const fail = (check: string, msg: string) => errors.push(`[${check}] ${msg}`);
const warn = (check: string, msg: string) => warnings.push(`[${check}] ${msg}`);

// ─── 工具 ────────────────────────────────────────────────────

function loadYaml(path: string): unknown {
	return parseYaml(readFileSync(path, 'utf8'));
}

function validate<T extends z.ZodType>(schema: T, data: unknown, label: string): z.infer<T> | null {
	const r = schema.safeParse(data);
	if (r.success) return r.data;
	for (const issue of r.error.issues) {
		const where = issue.path.length ? issue.path.join('.') : '(根)';
		fail('#1 schema', `${label} → ${where}：${issue.message}`);
	}
	return null;
}

function listDirs(p: string): string[] {
	if (!existsSync(p)) return [];
	return readdirSync(p)
		.filter((n) => !n.startsWith('.') && !n.startsWith('_'))
		.filter((n) => statSync(join(p, n)).isDirectory())
		.sort();
}

// ─── 載入 ────────────────────────────────────────────────────

type SiteBundle = {
	dir: string;
	site: z.infer<typeof SiteSchema> | null;
	soul: z.infer<typeof SoulSchema> | null;
	materials: z.infer<typeof MaterialSchema> | null;
	prompts: z.infer<typeof GuidedPromptSchema> | null;
	fallbacks: z.infer<typeof FallbackSchema> | null;
};

/**
 * 草稿站只要 site.yaml；宣告 playable 的站才要求五份齊全。
 *
 * ★ 判準是 site.yaml 裡的 `status`，不是「檔案缺不缺」。
 *   少一個檔可能是手滑，`status: draft` 是一句聲明——聲明才擋得住
 *   「不小心把半成品推上線」，推斷不行。
 */
const PLAYABLE_FILES = ['soul.yaml', 'materials.yaml', 'prompts.yaml', 'fallbacks.yaml'];

const siteDirs = listDirs(SITES_DIR);
const bundles: SiteBundle[] = [];

for (const dir of siteDirs) {
	const base = join(SITES_DIR, dir);
	const b: SiteBundle = {
		dir,
		site: null,
		soul: null,
		materials: null,
		prompts: null,
		fallbacks: null
	};

	const read = <T extends z.ZodType>(file: string, schema: T) =>
		existsSync(join(base, file))
			? validate(schema, loadYaml(join(base, file)), `${dir}/${file}`)
			: null;

	// site.yaml 一定要有——沒有它就連「這是不是一個景點」都不知道
	if (!existsSync(join(base, 'site.yaml'))) {
		fail('#2 完整性', `${dir}/ 缺少 site.yaml —— 沒有它連景點都不成立`);
	}

	b.site = read('site.yaml', SiteSchema);

	// #2 宣告 playable 的站才要求其餘四份。草稿站進不去，不會在現場開天窗。
	if (b.site?.status === 'playable') {
		for (const f of PLAYABLE_FILES) {
			if (!existsSync(join(base, f))) {
				fail(
					'#2 完整性',
					`${dir}/ 宣告 playable 但缺少 ${f} —— 缺一個就會在現場開天窗。還沒寫完就先留 status: draft`
				);
			}
		}
	}

	b.soul = read('soul.yaml', SoulSchema);
	b.materials = read('materials.yaml', MaterialSchema);
	b.prompts = read('prompts.yaml', GuidedPromptSchema);
	b.fallbacks = read('fallbacks.yaml', FallbackSchema);

	// 目錄名要跟 site.id 一致，否則載入器會找錯檔
	if (b.site && b.site.id !== dir) {
		fail('#2 完整性', `${dir}/site.yaml 的 id 是 "${b.site.id}"，與目錄名不符`);
	}

	bundles.push(b);
}

// 全域護欄（★ 全站唯一一份）
let guardrails: z.infer<typeof GuardrailsSchema> | null = null;
const guardrailsPath = join(CONTENT, 'guardrails.yaml');
if (existsSync(guardrailsPath)) {
	guardrails = validate(GuardrailsSchema, loadYaml(guardrailsPath), 'guardrails.yaml');
} else {
	fail('#1 schema', 'content/guardrails.yaml 不存在 —— 這是全站唯一的安全界線來源');
}

// 成就卡
let cards: z.infer<typeof CardsFileSchema> | null = null;
const cardsPath = join(CONTENT, 'cards.yaml');
if (existsSync(cardsPath)) {
	cards = validate(CardsFileSchema, loadYaml(cardsPath), 'cards.yaml');
}

// ─── 檢查 #3：史實必填出處，傳說要單列 ───────────────────────
//
// 落實企劃書 §4.2 第 5 條。素材庫是「一段 facts ＋ 幾條 legends」，所以：
//
//   · 整段 facts 至少要有一個 sources，而且不能是「網路」「維基」這種敷衍值
//   · 傳說歸 legends，本來就不必有出處——沒有定論正是它是傳說的原因
//
// ★ sources 的 min(1) 由 schema 負責，這裡補兩件 schema 做不到的事：
//   ① 出處不能是空白字串以外的敷衍值（「網路」「維基」這種等於沒寫）
//   ② facts 裡出現「有一種說法」「據說」「相傳」時提醒——那八成該搬去 legends

for (const b of bundles) {
	if (!b.materials) continue;

	for (const src of b.materials.sources) {
		if (/^(網路|網路上|維基|wiki|google|估狗|聽說|大家都知道)$/i.test(src.trim())) {
			fail(
				'#3 出處',
				`${b.dir}/materials.yaml 的 source "${src}" 等於沒寫 —— ` +
					`出處要能讓審的人真的查得到（機關公告、館方紀錄、研究文獻）`
			);
		}
	}

	const hedge = /有一種說法|有人說|據說|相傳|傳說|一說/;
	const zh = b.materials.facts.zhHant;
	if (hedge.test(zh)) {
		warn(
			'#3 出處',
			`${b.dir}/materials.yaml 的 facts 出現「有一種說法／據說／相傳」這類措辭 —— ` +
				`那通常表示那句話該搬到 legends。facts 是可以講得斬釘截鐵的部分`
		);
	}
}

// ─── 檢查 #3b：感應半徑必須大於判定半徑 ──────────────────────
// 反過來的話會出現「點得動但沒有漣漪」——玩家看不到任何提示卻進得去。

for (const b of bundles) {
	if (!b.site) continue;
	const { radiusM, sensingM } = b.site.geo;
	if (sensingM <= radiusM) {
		fail(
			'#3b 半徑',
			`${b.dir} 的 sensingM(${sensingM}) 不大於 radiusM(${radiusM}) —— 會變成點得動卻沒有漣漪`
		);
	}
}

// ─── 檢查 #4：民間傳說要有，或者明確地沒有 ───────────────────
//
// ⚠️ **編號沒有重用。** 舊的 #4 是「引導提問的 topic 都要有對應素材」，隨著
//    `topic` 欄位一起移除了。這是另一條規則，只是接在同一個編號後面——
//    重用編號會讓「#4 是什麼」在不同文件裡有兩個答案。
//
// 新的 #4 守的是另一件事：**空的 legends 必須是刻意的。**
//    幾乎每個有年代的地方都有說不清的傳說（剝皮寮的地名由來、紅樓的八卦形狀）。
//    legends 是空的通常不是「這裡沒有傳說」，是「還沒去想」。
//    這裡不擋建置，只把它唸出來——同 #7 的作法，不讓它安靜地存在。

for (const b of bundles) {
	if (!b.materials) continue;
	if (b.materials.legends.length === 0) {
		notes.push(
			`#4 傳說：${b.dir} 的 legends 是空的。確認過「這一站真的沒有說不清的說法」就好，` +
				`但空著通常表示還沒想過（地名由來、形狀的象徵解釋、誰蓋的⋯⋯）。`
		);
	}
}

// ─── 檢查 #5：每站引導提問恰好 3 題 ──────────────────────────
//
// **恰好 3 題**，理由見 content/schema.ts 的 GuidedPromptSchema 說明——
// 一句話：沒有回訪機制，多寫的題目九成玩家永遠看不到，但一樣要逐字審。
// 而且 L2 的版面是固定三個按鈕，多寫的沒地方放。
//
// 由 schema 的 .length(3) 負責，這裡只補一個更好讀的訊息。
// ★ 多寫也是錯：L2 的版面是固定三個按鈕，多出來的沒地方放。

const PROMPT_COUNT = 3;

for (const b of bundles) {
	if (!b.prompts) continue;
	const n = b.prompts.items.length;
	if (n !== PROMPT_COUNT) {
		fail(
			'#5 題數',
			`${b.dir} 有 ${n} 題引導提問，必須**恰好 ${PROMPT_COUNT} 題** —— ` +
				`L2 的版面是固定三個按鈕，多寫的沒地方放、少寫的會開天窗`
		);
	}
	// 15 字的建議不做成 schema 強制（中文字數不好定義），但這裡提醒。
	for (const item of b.prompts.items) {
		const len = [...item.text.zhHant].length;
		if (len > 15) {
			warn(
				'#5 題數',
				`${b.dir}/prompts.yaml 的 "${item.id}" 有 ${len} 字 —— ` +
					`它是可點擊的按鈕，建議 15 字內（長了排不下，這是踩出來的）`
			);
		}
	}
}

// ─── 檢查 #6：所有 LocalizedText.zhHant 非空 ─────────────────
// 由 schema 的 .min(1) 負責。這裡另外掃「看起來還沒寫」的佔位字串。

const PLACEHOLDER = /^(TODO|TBD|待填|待撰寫|xxx|測試)/i;

function scanPlaceholders(node: unknown, path: string) {
	if (node === null || node === undefined) return;
	if (typeof node === 'string') {
		if (PLACEHOLDER.test(node.trim()))
			warn('#6 佔位', `${path} 仍是佔位字串："${node.slice(0, 30)}"`);
		return;
	}
	if (Array.isArray(node)) {
		node.forEach((v, i) => scanPlaceholders(v, `${path}[${i}]`));
		return;
	}
	if (typeof node === 'object') {
		for (const [k, v] of Object.entries(node)) scanPlaceholders(v, `${path}.${k}`);
	}
}

for (const b of bundles) {
	scanPlaceholders(b.site, `${b.dir}/site`);
	scanPlaceholders(b.soul, `${b.dir}/soul`);
	scanPlaceholders(b.materials, `${b.dir}/materials`);
	scanPlaceholders(b.prompts, `${b.dir}/prompts`);
	scanPlaceholders(b.fallbacks, `${b.dir}/fallbacks`);
}

// ─── 檢查 #7：卡片總數 15，6/6/3 分佈 ────────────────────────
//
// ★ 這一項在所有景點都可遊玩之前無法成立（草稿站沒有卡片）。
//   所以它「自動啟用」：一旦六站都是 playable 就開始強制。
//   不是靜默跳過 —— 未啟用時會明確印出來，避免誤以為已經檢查過。

const playableDirs = bundles.filter((b) => b.site?.status === 'playable').map((b) => b.dir);
const draftDirs = bundles.filter((b) => b.site?.status !== 'playable').map((b) => b.dir);

// ★ 用「可遊玩」站數而不是資料夾數：草稿站沒有卡片，拿它去湊站數
//   會讓 #7 在內容還沒寫完時就開始強制，然後被當成雜訊關掉。
if (playableDirs.length >= EXPECTED_SITE_COUNT) {
	const list = cards?.cards ?? [];
	if (list.length !== EXPECTED_CARDS.total) {
		fail('#7 卡片', `卡片總數是 ${list.length}，應為 ${EXPECTED_CARDS.total}`);
	}
	for (const kind of ['encounter', 'task', 'story'] as const) {
		const n = list.filter((c) => c.kind === kind).length;
		if (n !== EXPECTED_CARDS[kind]) {
			fail('#7 卡片', `${kind} 卡有 ${n} 張，應為 ${EXPECTED_CARDS[kind]}`);
		}
	}
} else {
	notes.push(
		`#7 卡片總數檢查【尚未啟用】：目前 ${playableDirs.length}/${EXPECTED_SITE_COUNT} 站可遊玩，` +
			`全部可遊玩時自動開始強制 ${EXPECTED_CARDS.total} 張` +
			`（${EXPECTED_CARDS.encounter} 相遇 / ${EXPECTED_CARDS.task} 任務 / ${EXPECTED_CARDS.story} 劇情）。`
	);
}

// 卡片的 siteId 要指得到真的景點
if (cards && siteDirs.length > 0) {
	const ids = new Set(siteDirs);
	for (const c of cards.cards) {
		if (!ids.has(c.siteId))
			fail('#7 卡片', `卡片 "${c.id}" 的 siteId="${c.siteId}" 找不到對應景點`);
	}
}

// ─── 檢查 #7b：playable 的站必須恰有一張相遇卡 ────────────────
//
// ★ 為什麼要這一條（切片 4 加的）
//
//   `/api/site/:id/enter` 發卡時是**查** cards.yaml 拿 id，不是拼
//   `encounter-<siteId>` 這種約定出來的字串（理由見 lib/server/content/cards.ts）。
//   查表的代價就是這條規則：查不到就發不出卡。
//
//   沒有這條檢查的話，一站轉 playable 而忘了寫卡，玩家會走到現場、
//   進得去、聊得動，然後在 enter 收到 500。那個 500 應該在建置時就發生。
//
// ★ 「恰有一張」不是「至少一張」：兩張相遇卡的話，發卡時挑哪一張是沒有
//   定義的行為，而 getEncounterCard 會回它先找到的那張——一個看起來
//   隨機的結果。要嘛一張，要嘛在這裡就講清楚。
//
// ⚠️ 這一條只對 playable 的站生效。草稿站沒有卡片是正常狀態，
//   不是還沒寫完的錯——它本來就進不去。

if (playableDirs.length === 0) {
	// ★ 跟 #7 一樣：未啟用要講出來，不能靜默跳過。
	//   「這條規則現在沒有在檢查」與「這條規則檢查過了」必須看得出差別，
	//   否則下次有人看到一片綠，會以為相遇卡已經被驗過了。
	notes.push(
		`#7b 相遇卡檢查【尚未啟用】：目前沒有 playable 的站。一旦有站宣告 playable，` +
			`就會開始強制「該站必須恰有一張 kind: encounter 的卡」。`
	);
}

for (const b of bundles) {
	if (b.site?.status !== 'playable') continue;

	const mine = (cards?.cards ?? []).filter((c) => c.kind === 'encounter' && c.siteId === b.dir);

	if (mine.length === 0) {
		fail(
			'#7b 相遇卡',
			`${b.dir} 宣告 playable 但 cards.yaml 裡沒有它的相遇卡 —— ` +
				`玩家走到現場會拿到 500。要嘛補一張 kind: encounter 的卡，要嘛先留 status: draft`
		);
	} else if (mine.length > 1) {
		fail(
			'#7b 相遇卡',
			`${b.dir} 有 ${mine.length} 張相遇卡（${mine.map((c) => c.id).join('、')}）—— ` +
				`發卡時該挑哪一張沒有定義。一站只能有一張`
		);
	}
}

// ─── 檢查 #8：所有 art 路徑檔案存在 ──────────────────────────
// 避免上線後破圖。

const STATIC = join(ROOT, 'static');

function checkAsset(p: string | undefined, where: string) {
	if (!p) return;
	const abs = p.startsWith('/') ? join(STATIC, p) : join(ROOT, p);
	if (!existsSync(abs)) fail('#8 資產', `${where} 指向的檔案不存在：${p}`);
}

for (const b of bundles) {
	// 草稿站可以還沒有立繪（那是 P0-1 的產出）；宣告 playable 就必須有。
	if (b.site?.status === 'playable' && b.soul && b.soul.art === null) {
		fail('#8 資產', `${b.dir} 宣告 playable 但 soul.yaml 沒有 art —— 玩家會看到一個空的角色`);
	}
	checkAsset(b.soul?.art?.portrait, `${b.dir}/soul.yaml art.portrait`);
	const r = b.soul?.art?.renderer;
	if (r?.kind === 'layered-png') checkAsset(r.layersDir, `${b.dir}/soul.yaml renderer.layersDir`);
	if (r?.kind === 'live2d') checkAsset(r.modelPath, `${b.dir}/soul.yaml renderer.modelPath`);
}
for (const c of cards?.cards ?? []) {
	checkAsset(c.art.portrait, `cards.yaml "${c.id}" art.portrait`);
	checkAsset(c.art.frame, `cards.yaml "${c.id}" art.frame`);
}

// ─── 檢查 #9：persona 不得出現「神明說」類字串 ────────────────
// 企劃書 §4.2 第 2 條的靜態檢查。
// 靈魂要解釋自己怎麼知道某事，一律用它自己的觀察力。

for (const b of bundles) {
	if (!b.soul) continue;
	const blob = JSON.stringify(b.soul.persona);
	for (const phrase of FORBIDDEN_PERSONA_PHRASES) {
		if (blob.includes(phrase)) {
			fail(
				'#9 治理',
				`${b.dir}/soul.yaml 的 persona 出現「${phrase}」—— 靈魂不得轉述神明的話語（企劃書 §4.2 第 2 條）`
			);
		}
	}
}

// ─── 檢查 #10：hasStory 的站要有唯一 storyOrder ──────────────

const orders = new Map<number, string>();
for (const b of bundles) {
	if (!b.site) continue;
	if (b.site.hasStory) {
		if (b.site.storyOrder === null) {
			fail('#10 劇情', `${b.dir} 標了 hasStory 但沒有 storyOrder`);
		} else if (orders.has(b.site.storyOrder)) {
			fail(
				'#10 劇情',
				`storyOrder=${b.site.storyOrder} 重複：${orders.get(b.site.storyOrder)} 與 ${b.dir}`
			);
		} else {
			orders.set(b.site.storyOrder, b.dir);
		}
	} else if (b.site.storyOrder !== null) {
		fail('#10 劇情', `${b.dir} 沒有 hasStory 卻設了 storyOrder`);
	}
}

// ─── 額外：隱私 schema 硬約束（SDD §3.3）─────────────────────
// 資料庫 schema 裡不得出現任何位置欄位。
// 這不是慣例，是企劃書 §7、§8.8 的硬約束。

const DB_FILES = [join(ROOT, 'src/lib/server/db/schema.ts')];
const MIGRATIONS = join(ROOT, 'drizzle');
if (existsSync(MIGRATIONS)) {
	for (const f of readdirSync(MIGRATIONS)) {
		if (f.endsWith('.sql')) DB_FILES.push(join(MIGRATIONS, f));
	}
}

// 只看「欄位定義」那一側，註解裡提到 lat/lng 是合法的（本檔就有）
const GEO_COLUMN =
	/['"`](lat|lng|latitude|longitude|geography|geometry|coords?|location)['"`]\s*[,)]/i;

for (const f of DB_FILES) {
	if (!existsSync(f)) continue;
	const lines = readFileSync(f, 'utf8').split('\n');
	lines.forEach((line, i) => {
		const code = line.split('//')[0];
		if (GEO_COLUMN.test(code)) {
			fail(
				'★隱私',
				`${f.replace(ROOT + '/', '')}:${i + 1} 出現位置欄位 —— 本專案不建立任何位置軌跡類資料（企劃書 §7、§8.8）`
			);
		}
	});
}

// ─── 額外：範本檔不得含真實金鑰 ──────────────────────────────
//
// ★★★ 2026-09-03 由 GitHub 的推送保護抓到一次。★★★
//
// 那次是把 Gemini 金鑰填進了 `.env.example` 而不是 `.env`——兩個檔名只差五個字元，
// 一個進版控、一個不進。GitHub 擋下來了，但**那是最後一道防線，不該是唯一一道**：
// 它只認得它看得懂的金鑰格式，換一家供應商、換一種格式就未必攔得住。
//
// 這條檢查擋的是「範本裡的金鑰欄位有值」這個**結構性**錯誤，跟金鑰長什麼樣無關。
// 判準刻意只看欄位名與「是不是空的／是不是佔位」——愈簡單的規則愈不會誤判，
// 也就愈不會被人為了趕時間而關掉。

/** 這些後綴的欄位一律必須留空 */
const SECRET_FIELD = /(KEY|SECRET|TOKEN|PASSPHRASE|PASSWORD)$/;

/** 看起來像「等你來填」的值 */
const isPlaceholder = (v: string) => /^[<（]|^__|^your[-_]|^\$\{|[<>]|__/.test(v);

/** 連線字串裡的帳號與密碼。有一邊不是佔位就當成真憑證 */
const CREDENTIALS = /:\/\/([^/@\s]*):([^/@\s]*)@/;

const TEMPLATE_ENV_FILES = ['.env.example', 'deploy/env.example'];

for (const rel of TEMPLATE_ENV_FILES) {
	const abs = join(ROOT, rel);
	if (!existsSync(abs)) continue;

	readFileSync(abs, 'utf8')
		.split(/\r?\n/)
		.forEach((line, i) => {
			const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
			if (!m) return;
			const [, key, raw] = m;
			const value = raw.trim();
			if (value === '' || isPlaceholder(value)) return;

			if (SECRET_FIELD.test(key)) {
				fail(
					'★機密',
					`${rel}:${i + 1} 的 ${key} 有值 —— 範本會進版控，金鑰要填進 .env（不進版控）`
				);
			}

			const cred = CREDENTIALS.exec(value);
			if (cred && !(isPlaceholder(cred[1]) || isPlaceholder(cred[2]))) {
				fail(
					'★機密',
					`${rel}:${i + 1} 的 ${key} 是一組含真實帳密的連線字串 —— 改成 <帳號>:<密碼> 的佔位形式`
				);
			}
		});
}

// ─── 報告 ────────────────────────────────────────────────────

const line = '─'.repeat(64);
console.log(line);
console.log('內容驗證 content:check —— SDD §2.4');
console.log(line);
console.log(
	`景點：${siteDirs.length} 站 ${siteDirs.length ? `(${siteDirs.join(', ')})` : '(尚未建立任何景點)'}`
);
console.log(`\u3000可遊玩：${playableDirs.length ? playableDirs.join(', ') : '（無）'}`);
if (draftDirs.length > 0) {
	// ★ 草稿站每次建置都要被唸出來。「表建好了但沒人生產內容」是內容層最常見的爛法，
	//   對策不是禁止半成品存在，是不讓它安靜地存在。
	console.log(`\u3000🚧 草稿（進不去）：${draftDirs.join(', ')}`);
}
console.log(`成就卡：${cards?.cards.length ?? 0} 張`);
console.log(`全域護欄：${guardrails ? `${guardrails.rules.length} 條` : '❌ 缺少'}`);
console.log('');

for (const b of bundles) {
	if (b.site?.status === 'playable') continue;
	const missing = PLAYABLE_FILES.filter((f) => !existsSync(join(SITES_DIR, b.dir, f)));
	if (missing.length > 0) {
		notes.push(
			`${b.dir} 還缺：${missing.join('、')}\u3000（補齊後把 site.yaml 的 status 改成 playable）`
		);
		continue;
	}

	// ★ 五份檔案齊了**不等於**可以改 playable。宣告的那一刻還會撞到 #7b 與 #8，
	//   所以在這裡就把還缺的東西講出來——否則有人照著這行訊息去改 status，
	//   會當場被兩條他沒看過的規則擋下來。
	//   同一個原則：不讓「還沒過的檢查」看起來像「已經過了」。
	const blockers: string[] = [];
	if (b.soul?.art === null) {
		blockers.push('soul.yaml 的 art 還是 null（#8，等角色立繪）');
	}
	if (!(cards?.cards ?? []).some((c) => c.kind === 'encounter' && c.siteId === b.dir)) {
		blockers.push(`cards.yaml 裡沒有 ${b.dir} 的相遇卡（#7b）`);
	}

	if (blockers.length > 0) {
		notes.push(`${b.dir} 五份檔案都在了。改成 playable 之前還要：${blockers.join('；')}`);
	} else {
		notes.push(`${b.dir} 都齊了，#7b 與 #8 也都過得了 —— 審完就可以把 status 改成 playable`);
	}
}

for (const n of notes) console.log(`ℹ️  ${n}`);
if (notes.length) console.log('');

for (const w of warnings) console.log(`⚠️  ${w}`);
if (warnings.length) console.log('');

if (errors.length > 0) {
	for (const e of errors) console.error(`❌ ${e}`);
	console.error('');
	console.error(`${line}\n驗證失敗：${errors.length} 個錯誤。修好才能建置與部署。\n${line}`);
	process.exit(1);
}

console.log(`${line}`);
console.log(`✅ 通過${warnings.length ? `（${warnings.length} 個警告）` : ''}`);
console.log(`${line}`);
