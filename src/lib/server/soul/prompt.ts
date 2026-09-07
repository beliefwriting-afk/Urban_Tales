/**
 * System prompt 組裝 —— SDD §6.2、§6.3。
 *
 * ★★★ 四段的順序是安全設計，不是排版偏好。★★★
 *
 *   [1] 角色人格卡      ← 可被後面覆寫
 *   [2] 地方故事素材庫
 *   [3] 回答格式與長度要求
 *   [4] ★ 全域安全界線  ← **最後注入**，且開頭明文宣告優先權最高
 *
 *   為什麼護欄放最後：語言模型對系統提示後段的遵循度較高，而且
 *   「最後一段推翻前面」的語意最不容易被角色設定稀釋（§6.2）。
 *   `prompt.spec.ts` 有一條測試把這個順序釘死——順序寫錯的話，
 *   **產生的 prompt 看起來完全正常，只有護欄變弱**，沒有人會發現。
 *
 * ★ 純函式：不讀檔、不碰資料庫、不碰 AI。內容由呼叫端（speak.ts）載好傳進來。
 *
 * 給 Python 背景的對照：
 *   陣列 `.join('\n')`   ≈ '\n'.join(list)
 *   模板字串 `${x}`      ≈ f-string 的 {x}
 *   `.filter(Boolean)`   ≈ [x for x in list if x]（濾掉空字串與 null）
 */
import type { Guardrails, Material, Soul } from '../../../../content/schema';

export type PromptInput = {
	soul: Soul;
	materials: Material;
	guardrails: Guardrails;
};

const RULE = '────────────────────────────';

/** [1] 人格卡。整段逐字進 prompt（SDD §6.2 的 [1]） */
function personaSection(soul: Soul): string {
	const p = soul.persona;
	const parts = [
		'【一、你是誰】',
		'',
		p.identity.zhHant.trim(),
		'',
		'【你怎麼說話】',
		'',
		p.voice.zhHant.trim(),
		'',
		'【你憑什麼知道這些事】',
		'',
		p.knows.zhHant.trim(),
		'',
		'【你不是誰】',
		...p.isNot.map((x) => `- ${x.zhHant.trim()}`)
	];

	// ⚠️ taboos 可以是空陣列（schema 的 .default([])）。空的時候整個標題都不要印——
	//    印一個「【你不談的事】」底下什麼都沒有，會讓模型自己去猜那是什麼意思。
	if (p.taboos.length > 0) {
		parts.push(
			'',
			'【你不談的事】（這一站專屬，全域安全界線之外的追加）',
			...p.taboos.map((x) => `- ${x.zhHant.trim()}`)
		);
	}

	return parts.join('\n');
}

/**
 * [2] 素材庫。
 *
 * ★★★ facts 與 legends 必須用不同的語氣指示，這是護欄第 5 條的實作基礎。★★★
 *   查得到的事可以斬釘截鐵；說不清的事必須把幾種說法都講出來並說明沒有定論。
 *   兩者若混成一段，「八卦祈福、十字架鎮邪」跟「文化局的古蹟公告」在模型眼裡
 *   長得一樣，它會用同一種語氣講出來（content/schema.ts 的 MaterialSchema 說明）。
 *
 * ⚠️ `sources` 不進 prompt。它只給審內容的人查證用，模型不需要、也不該轉述它。
 *   所以這裡逐欄位取用，**不是** JSON.stringify 整包——那會把 sources 一起送進去。
 */
function materialsSection(m: Material): string {
	const parts = [
		'【二、這個地方的故事】',
		'',
		'以下是查得到的事。這些你可以講得斬釘截鐵：',
		'',
		m.facts.zhHant.trim()
	];

	if (m.legends.length > 0) {
		parts.push(
			'',
			'以下是說不清的事——有人這樣講，但沒有定論。',
			'提到這些的時候，要把幾種說法都說出來，並說明沒有定論，不要宣稱哪一種才對：',
			'',
			...m.legends.map((l) => `- ${l.text.zhHant.trim()}`)
		);
	}

	return parts.join('\n');
}

/** [3] 回答格式。全站共用一份，來源是 content/guardrails.yaml 的 outputFormat */
function formatSection(g: Guardrails): string {
	return ['【三、回答的格式】', '', g.outputFormat.trim()].join('\n');
}

/**
 * [4] ★ 全域安全界線。**永遠是最後一段。**
 *
 * `precedence`（優先權宣告）在八條規則之前——它的作用是「以下這些推翻上面全部」，
 * 排在規則後面就沒有意義了。
 */
function guardrailsSection(g: Guardrails): string {
	return [
		'【四、安全界線】',
		'',
		g.precedence.trim(),
		'',
		...g.rules.map((r) => `${r.id}. ${r.title}\n${r.instruction.trim()}`)
	].join('\n');
}

/**
 * 組出完整的 system prompt。
 *
 * ⚠️ 這裡**不含玩家的輸入，也不含對話歷史**——那些是 messages，不是 system。
 *   分開的理由不只是介面乾淨：固定前綴每站固定（§6.3 的框圖），
 *   混進變動內容會讓「哪一段是固定的」變得說不清楚。
 */
export function buildSystemPrompt(input: PromptInput): string {
	const { soul, materials, guardrails } = input;

	return [
		personaSection(soul),
		materialsSection(materials),
		formatSection(guardrails),
		guardrailsSection(guardrails)
	].join(`\n\n${RULE}\n\n`);
}
