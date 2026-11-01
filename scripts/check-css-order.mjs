// 构建产物守卫：超宽屏上限 `min-[112.5rem]:max-w-[160rem]` 必须排在 `2xl:max-w-[110rem]` 之后，否则被前者盖掉（线上失效过）。
// 源码正则只能证明「写了什么」，层叠顺序只有构建后的 CSS 才看得出来。CI 在 vite build 之后跑。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(process.cwd(), 'dist', 'assets')
const css = readdirSync(dir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n')

const at = (needle) => css.indexOf(needle)
// 压缩后的选择器：数字开头的类名被转义成 `\32 `（反斜杠 + 32），所以 2xl 在 CSS 里是 `\32xl`
const base = at(String.raw`\32xl\:max-w-\[110rem\]`)
const wide = at(String.raw`min-\[112\.5rem\]\:max-w-\[160rem\]`)
if (base < 0 || wide < 0) {
  console.error(`❌ 构建 CSS 里找不到断点规则（2xl:max-w-[110rem]=${base}，min-[112.5rem]:max-w-[160rem]=${wide}）；改了 App.tsx 的类名要同步本脚本`)
  process.exit(1)
}
if (wide < base) {
  console.error('❌ 超宽屏规则排在 2xl 之前，会被盖掉：二者必须同用 rem 单位')
  process.exit(1)
}
console.log('✅ 断点层叠顺序正确（112.5rem 在 2xl 之后）')
