# Python → TypeScript 速查表

> 給君和。卡住的時候翻這一份。
> 最後更新：2026-08-25

---

## 心法三句

1. **骨架對得過去，細節會咬你。** 函式、迴圈、型別註記、`async/await`、`import` 都有對應物，但有五個地方會無聲地錯。
2. **TypeScript ≈ Python + 永遠開著的 mypy。** Python 的 type hint 執行期不檢查，TS 的型別編譯期強制。它是來幫你的，不是來煩你的。
3. **你真正要學的不是 TypeScript，是瀏覽器。** Canvas、相機、定位這些才是這個專案的難度所在，換語言也躲不掉。

---

## 一、生態系對照（先看這個，最省力）

| Python | TypeScript / Node | 說明 |
|---|---|---|
| `pip` | `npm` | 套件管理 |
| `pyproject.toml` | `package.json` | 專案設定與相依清單 |
| `.venv/` | `node_modules/` | 相依裝在專案內。**兩者都不進 git** |
| `python -m venv` | 不需要 | Node 天生就是專案本地隔離 |
| `mypy` | `tsc` | 型別檢查（TS 內建，不用另外裝） |
| **`pydantic`** | **`zod`** | **執行期資料驗證。這個對照最重要** |
| `SQLAlchemy` | `drizzle` | ORM |
| `pytest` | `vitest` | 測試 |
| `ruff` / `flake8` | `eslint` | 靜態檢查 |
| `black` | `prettier` | 自動排版 |
| `FastAPI` | SvelteKit 的 server routes | 後端路由 |
| `dataclass` | `type` / `interface` | 但 TS 的型別**執行期不存在**，見下方 |
| `requests` | `fetch` | HTTP（瀏覽器與 Node 都內建） |

**最關鍵的一組是 Zod ≈ pydantic。** 因為 TypeScript 的型別在編譯後**完全消失**，執行期什麼都不剩。所以凡是「從外部進來的資料」（讀檔、API 回應、使用者輸入），型別註記保護不到你，必須用 Zod 在執行期驗證——就像你在 Python 裡不會信任外部 JSON、要用 pydantic 過一遍一樣。

本專案的 `content/schema.ts` 就是在做這件事。

---

## 二、基礎語法對照

| 主題 | Python | TypeScript |
|---|---|---|
| 變數 | `x = 1` | `const x = 1;`（不變）／ `let x = 1;`（會變） |
| 型別註記 | `x: int = 1` | `const x: number = 1;` |
| 註解 | `# 註解` | `// 註解` |
| 區塊 | 縮排 | `{ }` 大括號 |
| 字串插值 | `f"你好 {name}"` | `` `你好 ${name}` ``（反引號，不是單引號） |
| 空值 | `None` | `null` **和** `undefined`（兩種！） |
| 真假 | `True` / `False` | `true` / `false`（小寫） |
| 且／或／非 | `and` / `or` / `not` | `&&` / `\|\|` / `!` |
| 相等 | `==` | `===`（**一律用三個等號**） |
| 不等 | `!=` | `!==` |
| 條件 | `if x: ... elif: ... else:` | `if (x) { ... } else if { ... } else { ... }` |
| 三元 | `a if cond else b` | `cond ? a : b` |
| 迴圈 | `for x in arr:` | `for (const x of arr) { }` |
| 長度 | `len(arr)` | `arr.length`（不是函式，是屬性） |
| 加元素 | `arr.append(x)` | `arr.push(x)` |
| 最後一個 | `arr[-1]` | `arr.at(-1)`（**不能寫 `arr[-1]`**） |
| 切片 | `arr[1:3]` | `arr.slice(1, 3)` |
| 包含 | `x in arr` | `arr.includes(x)` |
| 字典取值（有預設） | `d.get(k, "預設")` | `obj[k] ?? "預設"` |
| 解構 | `a, b = pair` | `const [a, b] = pair;` |
| 展開 | `[*a, *b]` | `[...a, ...b]` |
| 例外 | `try / except / finally` | `try / catch / finally` |
| 丟例外 | `raise ValueError("壞了")` | `throw new Error("壞了");` |

---

## 三、🔴 五個會咬你的坑

### 坑 1：空陣列和空物件是「真」的

**這是頭號殺手，因為它無聲地錯。**

```python
# Python
if []:        # False
if {}:        # False
if "":        # False
if 0:         # False
```

```typescript
// TypeScript
if ([])       // true  ⚠️
if ({})       // true  ⚠️
if ("")       // false
if (0)        // false
```

只有 `""`、`0`、`null`、`undefined`、`NaN`、`false` 是假的。**任何物件和陣列，不管空不空，都是真的。**

```typescript
// ❌ 錯：空陣列也會進去
if (achievements) { showCards(achievements); }

// ✅ 對
if (achievements.length > 0) { showCards(achievements); }
```

---

### 坑 2：`null` 和 `undefined` 是兩種「沒有」

Python 只有 `None`。JS 有兩個：

- `undefined`＝**根本沒設定過**（變數宣告了沒賦值、物件沒這個屬性、函式沒回傳）
- `null`＝**刻意設為空**（你自己寫的）

```typescript
const site = sites.find((s) => s.id === "bopiliao");
// 找不到時回傳 undefined，不是 null

// 一次擋掉兩種，用 == 兩個等號（這是唯一的例外）
if (site == null) { return; }

// 或用可選鏈 + 空值合併
const name = site?.name ?? "未知景點";
```

`?.` 是「如果前面是 null/undefined 就整串回傳 undefined，不要爆」，`??` 是「如果左邊是 null/undefined 就用右邊」。這兩個超好用，Python 沒有直接對應。

---

### 坑 3：`.sort()` 預設按**字串**排序

```python
# Python
sorted([1, 10, 2])        # [1, 2, 10] ✅
```

```typescript
// TypeScript
[1, 10, 2].sort()                  // [1, 10, 2] ⚠️ 按字串比 "1" < "10" < "2"
[1, 10, 2].sort((a, b) => a - b)   // [1, 2, 10] ✅
```

而且 `.sort()` 是**原地修改**（像 Python 的 `list.sort()`，不是 `sorted()`）。要不動原陣列：

```typescript
const sorted = [...arr].sort((a, b) => a - b);
```

---

### 坑 4：物件的 key 只能是字串

```python
# Python：任何可雜湊的東西都能當 key
d = {1: "a", (2, 3): "b"}
```

```typescript
// TypeScript：物件的 key 會被硬轉成字串
const obj = { 1: "a" };   // key 其實是 "1"

// 需要任意型別的 key，用 Map
const m = new Map<number, string>();
m.set(1, "a");
m.get(1);
```

日常用純物件就夠（`Record<string, T>` 對應 Python 的 `dict[str, T]`）。

---

### 坑 5：標準庫幾乎不存在

Python 是 batteries included，`datetime`、`json`、`re`、`csv`、`pathlib` 都內建。

JS 內建的很少：`JSON.parse` / `JSON.stringify` 有，正則有（`/pattern/`），日期有但 `Date` 難用到出名。其他**基本上都要從 npm 裝**。

這不是缺點，只是習慣要改：**遇到需求先想「有沒有套件」，而不是「標準庫在哪」。**

---

## 四、集合操作：忘掉 comprehension

這是寫起來差最多、但最快習慣的一塊。

| 目的 | Python | TypeScript |
|---|---|---|
| 轉換每一項 | `[f(x) for x in arr]` | `arr.map(f)` |
| 篩選 | `[x for x in arr if p(x)]` | `arr.filter(p)` |
| 兩者一起 | `[f(x) for x in arr if p(x)]` | `arr.filter(p).map(f)` |
| 找第一個 | `next((x for x in arr if p(x)), None)` | `arr.find(p)` |
| 有沒有任一個 | `any(p(x) for x in arr)` | `arr.some(p)` |
| 是不是全部 | `all(p(x) for x in arr)` | `arr.every(p)` |
| 累加 | `sum(arr)` | `arr.reduce((a, b) => a + b, 0)` |
| 排序 | `sorted(arr, key=f)` | `[...arr].sort((a, b) => f(a) - f(b))` |

實例——找出玩家目前在範圍內的景點：

```python
# Python
nearby = [s for s in sites if is_at_site(s, lat, lng)]
```

```typescript
// TypeScript
const nearby = sites.filter((s) => isAtSite(s, lat, lng));
```

`(s) => ...` 是箭頭函式，等於 Python 的 `lambda s: ...`，但可以寫多行（用大括號 + `return`）。

---

## 五、型別怎麼寫

```python
# Python
from dataclasses import dataclass
from typing import Optional, Literal

@dataclass
class Soul:
    id: str
    name: str
    site_id: str
    portrait: Optional[str] = None

CardKind = Literal["encounter", "quest", "story"]
```

```typescript
// TypeScript
type Soul = {
  id: string;
  name: string;
  siteId: string;
  portrait?: string;      // ? = 可有可無，等於 Optional
};

type CardKind = "encounter" | "quest" | "story";
```

其他常用對應：

| Python | TypeScript |
|---|---|
| `str` / `int` / `float` / `bool` | `string` / `number` / `number` / `boolean` |
| `list[str]` | `string[]` |
| `dict[str, int]` | `Record<string, number>` |
| `tuple[float, float]` | `[number, number]` |
| `Optional[str]` | `string \| null`（或 `?:`） |
| `Literal["a","b"]` | `"a" \| "b"` |
| `None`（回傳型別） | `void` |
| `Any` | `any`（**盡量別用**，等於關掉保護） |

> **命名慣例**：Python 用 `snake_case`，TypeScript 用 `camelCase`。所以 `site_id` → `siteId`、`radius_m` → `radiusM`。

---

## 六、非同步：概念一樣，一個關鍵差異

```python
# Python
async def fetch_soul(site_id: str) -> Soul:
    resp = await client.get(f"/api/souls/{site_id}")
    return resp.json()
```

```typescript
// TypeScript
async function fetchSoul(siteId: string): Promise<Soul> {
  const resp = await fetch(`/api/souls/${siteId}`);
  return await resp.json();
}
```

幾乎一樣。**關鍵差異**：Python 有阻塞版本可以退回去（`requests` vs `httpx`）。JavaScript **沒有**——所有 I/O 一律非同步，你沒得選。

實務影響：`async` 會往上傳染。一個函式裡有 `await`，它就必須是 `async`，呼叫它的人也得 `await`。這在 Python 也一樣，只是在 JS 你躲不掉。

---

## 七、Svelte 的反應式狀態

這是唯一一個 Python 沒有對應概念的東西，但比 React 單純很多。

```svelte
<script lang="ts">
  let count = $state(0);              // 會觸發畫面更新的變數
  let doubled = $derived(count * 2);  // 自動跟著 count 變
</script>

<button onclick={() => count++}>
  按了 {count} 次，兩倍是 {doubled}
</button>
```

心智模型：**`$state` 包起來的變數一改，用到它的畫面自動重畫。** 你不用手動去更新 DOM。

`$derived` 就是「這個值是別的值算出來的」，你只要寫公式，什麼時候重算它自己管。

---

## 八、Python 在這個專案的正當位置

放在 repo 的 `tools/`，**離線跑，不部署、不進 runtime**：

- 內容檔批次檢查（有沒有違反內容治理硬規則）
- 舊格式轉檔（萬華主線〈回家的畫〉→ 新的人格卡格式）
- 台詞量統計（哪一站的內容明顯偏少）
- 之後若要做內容生成輔助

這些是文字處理與資料清理，**本來就是 Python 主場**，而且離線執行不影響架構。用你最順手的語言做這部分完全合理。

---

## 九、卡住的時候

1. 先看編輯器的紅線訊息。TypeScript 的錯誤訊息比 Python 囉唆，但通常直接告訴你答案（包括「你是不是想打 `siteId`？」）
2. 對照上面第三節那五個坑，一半的詭異行為都在裡面
3. 還是不對就直接問我，把紅線的完整訊息貼過來
