/**
 * 輸出端檢查 —— `speak()` 第 8 步。
 *
 * ★ 純函式。這是護欄的**第二道**：第一道是 prompt 裡的八條規則（模型自己遵守），
 *   這一道是它沒遵守時的攔截。
 *
 * ⚠️ 兩道的性質完全不同，不要把這裡當成主要防線：
 *   prompt 那道管的是「怎麼說話」，涵蓋語意；這裡只認得**字串**，
 *   只擋得住最粗糙的違規。指望字串比對擋住越獄是危險的樂觀。
 *
 * ★ 為什麼還是要有：護欄第 2 條（不轉述神明話語）是本專案最不能破的一條，
 *   而它剛好有一個**可以字串比對的形態**——「菩薩說」「神明告訴我」這類固定說法。
 *   能機械化擋住的那一小塊就機械化擋住，剩下的交給 prompt。
 *
 * ⚠️ 與 content:check #9 共用同一份 `FORBIDDEN_PERSONA_PHRASES`（content/schema.ts）。
 *   #9 掃的是**人格卡**（我們自己寫的內容），這裡掃的是**模型的輸出**。
 *   同一份清單、兩個時機：建置期擋我們寫錯，執行期擋模型講錯。
 */
import { FORBIDDEN_PERSONA_PHRASES } from '../../../../content/schema';

export type OutputRejection = 'empty' | 'forbidden_phrase' | 'too_long';

export type OutputCheck = { ok: true; text: string } | { ok: false; why: OutputRejection };

/**
 * 輸出的硬上限（字）。
 *
 * ★ 格式要求叫模型寫「2–4 句、不超過 120 字」，但這裡放到 300。
 *   兩個數字的用途不一樣：120 是**期望**，300 是**失控的界線**。
 *   模型偶爾多寫兩句就給玩家保底台詞，是拿玩家的體驗去懲罰一個無害的偏差；
 *   而寫到 300 字以上通常代表它開始寫文件了——那才是真的偏離角色。
 */
export const OUTPUT_MAX_CHARS = 300;

export function checkOutput(raw: string, maxChars: number = OUTPUT_MAX_CHARS): OutputCheck {
	const text = raw.trim();

	// 空回應要當失效處理。回一句空白給玩家，比回保底台詞糟得多——
	// 畫面上那是一個「靈魂沉默了」的狀態，而我們沒有設計那個狀態。
	if (text.length === 0) return { ok: false, why: 'empty' };

	// ★ 護欄第 2 條的執行期攔截。企劃書 §4.2 第 2 條是硬規則，
	//   寧可讓玩家收到一句「這個我沒看過」，也不要讓靈魂替神明說話。
	for (const phrase of FORBIDDEN_PERSONA_PHRASES) {
		if (text.includes(phrase)) return { ok: false, why: 'forbidden_phrase' };
	}

	// ⚠️ 按「字」算不是按 UTF-16 碼元算，同 checkInputLength。
	if ([...text].length > maxChars) return { ok: false, why: 'too_long' };

	return { ok: true, text };
}
