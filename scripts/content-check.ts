#!/usr/bin/env node
/**
 * 建置期內容驗證 —— SDD §2.4 的十項，外加隱私 schema 檢查。
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

/** 五站齊備時，卡片總數檢查（#7）自動啟用。見下方 check7 的說明。 */
const EXPECTED_SITE_COUNT = 5;
const EXPECTED_CARDS = { total: 13, encounter: 5, task: 5, story: 3 } as const;

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

const REQUIRED_FILES = [
	'site.yaml',
	'soul.yaml',
	'materials.yaml',
	'prompts.yaml',
	'fallbacks.yaml'
];

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

	// #2 每個 site 都要有 soul / materials / prompts / fallbacks
	for (const f of REQUIRED_FILES) {
		if (!existsSync(join(base, f))) {
			fail('#2 完整性', `${dir}/ 缺少 ${f} —— 缺一個就會在現場開天窗`);
		}
	}

	const read = <T extends z.ZodType>(file: string, schema: T) =>
		existsSync(join(base, file))
			? validate(schema, loadYaml(join(base, file)), `${dir}/${file}`)
			: null;

	b.site = read('site.yaml', SiteSchema);
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

// ─── 檢查 #3：史實類素材必填出處 ─────────────────────────────
// 落實企劃書 §4.2 第 5 條。

for (const b of bundles) {
	for (const item of b.materials?.items ?? []) {
		if (item.kind === '已知史實' && !item.source) {
			fail('#3 出處', `${b.dir}/materials.yaml 的 "${item.id}" 標為已知史實但沒有 source`);
		}
	}
}

// ─── 檢查 #4：引導提問的 topic 都要有對應素材 ────────────────
// 避免問了但角色答不出來。

for (const b of bundles) {
	const topics = new Set((b.materials?.items ?? []).map((m) => m.topic));
	for (const p of b.prompts?.items ?? []) {
		if (!topics.has(p.topic)) {
			fail(
				'#4 對應',
				`${b.dir}/prompts.yaml 的 "${p.id}" topic="${p.topic}" 在 materials 找不到對應素材`
			);
		}
	}
}

// ─── 檢查 #5：每站引導提問 ≥ 12 題 ───────────────────────────
// 由 schema 的 .min(12) 負責，這裡只補一個更好讀的訊息。

for (const b of bundles) {
	const n = b.prompts?.items.length ?? 0;
	if (b.prompts && n < 12) {
		fail('#5 題數', `${b.dir} 只有 ${n} 題引導提問，需要 ≥ 12（重複感是「這是機器人」的主因）`);
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

// ─── 檢查 #7：卡片總數 13，5/5/3 分佈 ────────────────────────
//
// ★ 這一項在五站齊備前無法成立（兩個景點尚未拍板，見 HANDOFF §6）。
//   所以它「自動啟用」：一旦 content/sites/ 有五站就開始強制。
//   不是靜默跳過 —— 未啟用時會明確印出來，避免誤以為已經檢查過。

if (siteDirs.length >= EXPECTED_SITE_COUNT) {
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
		`#7 卡片總數檢查【尚未啟用】：目前 ${siteDirs.length}/${EXPECTED_SITE_COUNT} 站，` +
			`五站齊備時自動開始強制 13 張（5 相遇 / 5 任務 / 3 劇情）。`
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

// ─── 檢查 #8：所有 art 路徑檔案存在 ──────────────────────────
// 避免上線後破圖。

const STATIC = join(ROOT, 'static');

function checkAsset(p: string | undefined, where: string) {
	if (!p) return;
	const abs = p.startsWith('/') ? join(STATIC, p) : join(ROOT, p);
	if (!existsSync(abs)) fail('#8 資產', `${where} 指向的檔案不存在：${p}`);
}

for (const b of bundles) {
	checkAsset(b.soul?.art.portrait, `${b.dir}/soul.yaml art.portrait`);
	const r = b.soul?.art.renderer;
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

// ─── 報告 ────────────────────────────────────────────────────

const line = '─'.repeat(64);
console.log(line);
console.log('內容驗證 content:check —— SDD §2.4');
console.log(line);
console.log(
	`景點：${siteDirs.length} 站 ${siteDirs.length ? `(${siteDirs.join(', ')})` : '(尚未建立任何景點)'}`
);
console.log(`成就卡：${cards?.cards.length ?? 0} 張`);
console.log(`全域護欄：${guardrails ? `${guardrails.rules.length} 條` : '❌ 缺少'}`);
console.log('');

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
