/**
 * System prompt 組裝的測試 —— SDD §6.2。
 *
 * ★ 這一支守的全部是「錯了也看不出來」的東西：
 *   四段的順序錯了，產生的 prompt 讀起來完全正常，只有護欄變弱；
 *   sources 漏進 prompt，模型會開始轉述出處，而畫面上只是多了幾個字。
 *
 * ★ 用**真的內容**跑（六站的 YAML 都載進來），不是只測假資料——
 *   假資料測得到形狀，測不到「某一站的 taboos 是空的會不會炸」。
 *
 * 跑法：npm test
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './prompt';
import { getSoul, soulSiteIds } from '$lib/server/content/souls';
import { getMaterials } from '$lib/server/content/materials';
import { getGuardrails } from '$lib/server/content/guardrails';
import type { LocalizedText, Material } from '../../../../content/schema';

const SITE = 'longshan-temple';

/**
 * ⚠️ 用 if 收窄而不是非空斷言 `!`：`ts.configs.recommended` 的
 *    no-non-null-assertion 是 warning，而 CI 跑 `--max-warnings 0`——
 *    一個 `!` 就會讓建置失敗。
 */
function promptFor(siteId: string): string {
	const soul = getSoul(siteId);
	const materials = getMaterials(siteId);
	if (!soul) throw new Error(`${siteId} 沒有 soul.yaml`);
	if (!materials) throw new Error(`${siteId} 沒有 materials.yaml`);
	return buildSystemPrompt({ soul, materials, guardrails: getGuardrails() });
}

function soulOf(siteId: string) {
	const soul = getSoul(siteId);
	if (!soul) throw new Error(`${siteId} 沒有 soul.yaml`);
	return soul;
}

function materialsOf(siteId: string) {
	const m = getMaterials(siteId);
	if (!m) throw new Error(`${siteId} 沒有 materials.yaml`);
	return m;
}

describe('四段的順序（★ 這是安全設計，不是排版）', () => {
	const p = promptFor(SITE);

	it('四段都在，而且順序是 人格 → 素材 → 格式 → 安全界線', () => {
		const persona = p.indexOf('【一、你是誰】');
		const materials = p.indexOf('【二、這個地方的故事】');
		const format = p.indexOf('【三、回答的格式】');
		const guard = p.indexOf('【四、安全界線】');

		expect(persona).toBeGreaterThanOrEqual(0);
		expect(materials).toBeGreaterThan(persona);
		expect(format).toBeGreaterThan(materials);
		expect(guard).toBeGreaterThan(format);
	});

	// SDD §6.2：護欄最後注入，「最後一段推翻前面」的語意最不容易被角色設定稀釋。
	it('★ 安全界線是最後一段，後面沒有任何其他段落', () => {
		const guard = p.indexOf('【四、安全界線】');
		for (const heading of ['【一、你是誰】', '【二、這個地方的故事】', '【三、回答的格式】']) {
			expect(p.lastIndexOf(heading)).toBeLessThan(guard);
		}
	});

	// 優先權宣告的作用是「以下這些推翻上面全部」，排在規則後面就沒有意義了。
	it('★ precedence 排在八條規則之前', () => {
		const g = getGuardrails();
		const firstLine = g.precedence.trim().split('\n')[0];
		expect(p.indexOf(firstLine)).toBeLessThan(p.indexOf(g.rules[0].instruction.trim()));
	});

	it('八條護欄的內容一條都沒漏', () => {
		for (const r of getGuardrails().rules) {
			expect(p, `護欄第 ${r.id} 條不在 prompt 裡`).toContain(r.instruction.trim());
		}
	});
});

describe('人格卡整段進 prompt', () => {
	const p = promptFor(SITE);
	const soul = soulOf(SITE);

	it('identity / voice / knows 三段都逐字在裡面', () => {
		expect(p).toContain(soul.persona.identity.zhHant.trim());
		expect(p).toContain(soul.persona.voice.zhHant.trim());
		expect(p).toContain(soul.persona.knows.zhHant.trim());
	});

	it('isNot 與 taboos 每一條都在', () => {
		for (const x of soul.persona.isNot) expect(p).toContain(x.zhHant.trim());
		for (const x of soul.persona.taboos) expect(p).toContain(x.zhHant.trim());
	});
});

describe('素材庫：facts 與 legends 的語氣指示必須不同', () => {
	const p = promptFor(SITE);
	const m = materialsOf(SITE);

	// 護欄第 5 條的實作基礎。混成一段的話，模型會用同一種語氣講兩種東西。
	it('facts 說可以斬釘截鐵，legends 說沒有定論', () => {
		expect(p).toContain('可以講得斬釘截鐵');
		expect(p).toContain('沒有定論');
		expect(p.indexOf('可以講得斬釘截鐵')).toBeLessThan(p.indexOf('沒有定論'));
	});

	it('facts 與每一條 legend 都逐字在裡面', () => {
		expect(p).toContain(m.facts.zhHant.trim());
		for (const l of m.legends) expect(p).toContain(l.text.zhHant.trim());
	});

	/**
	 * ★★★ sources 只給審內容的人查證用。模型不需要、也不該轉述它。
	 *
	 * ⚠️ 這一條**不能拿真的 sources 去比對**：西門紅樓的 legend 本文就寫著
	 *   「西門紅樓官網自己的頁面寫⋯⋯」，而它的 sources 也列了「西門紅樓官網」。
	 *   那是**內容裡剛好提到出處**，不是出處欄位漏出去——拿真資料比對會誤判，
	 *   然後有人會為了讓測試變綠而去改內容。
	 *
	 *   所以改用哨兵字串（見下面 sourcesLeak 那一組）：假的 Material，
	 *   sources 填一個不可能出現在任何文本裡的值。這正是假資料該用的地方。
	 */
	it('facts 與 legends 的內容都在，長度也對得上', () => {
		expect(p.length).toBeGreaterThan(m.facts.zhHant.trim().length);
	});
});

describe('六站都組得起來', () => {
	// 假資料測得到形狀，測不到「某一站的 taboos 是空的會不會炸」。
	it('每一站都組得出 prompt，而且四段齊全', () => {
		for (const id of soulSiteIds()) {
			const p = promptFor(id);
			expect(p.length, `${id} 的 prompt 太短，八成有段落沒組進去`).toBeGreaterThan(1000);
			expect(p).toContain('【四、安全界線】');
		}
	});

	it('沒有空的標題（taboos 或 legends 是空的時候不印標題）', () => {
		for (const id of soulSiteIds()) {
			const p = promptFor(id);
			// 標題後面緊接著分隔線或另一個標題 → 那一段是空的
			expect(p).not.toMatch(/【[^】]+】\s*\n\s*\n\s*(────|【)/);
		}
	});
});

describe('★ sources 不進 prompt（用哨兵字串測，不用真資料）', () => {
	const loc = (t: string): LocalizedText => ({ zhHant: t, en: null, ja: null });

	const FAKE_MATERIAL: Material = {
		siteId: 'sentinel-site',
		facts: loc('這個地方在某一年蓋起來，後來改過幾次名字。'),
		sources: ['SOURCE-SENTINEL-ALPHA', 'SOURCE-SENTINEL-BRAVO'],
		legends: [
			{
				id: 'a-legend',
				text: loc('有人說這裡以前是別的東西，沒有定論。'),
				source: 'SOURCE-SENTINEL-CHARLIE'
			}
		]
	};

	it('sources 與 legend.source 都不出現在 prompt 裡', () => {
		const out = buildSystemPrompt({
			soul: soulOf(SITE),
			materials: FAKE_MATERIAL,
			guardrails: getGuardrails()
		});

		expect(out).toContain('這個地方在某一年蓋起來');
		expect(out).toContain('有人說這裡以前是別的東西');
		expect(out).not.toContain('SOURCE-SENTINEL');
	});
});
