你是排版修复员。下面是若干个**渲染失败**的富内容块（mermaid 图 / genui 组件 JSON / html 小部件），请逐个修好。

## 规则
1. 只修**格式与语法**，保持原意：不增删事实、不改写含义；块里的文字尽量原样保留
2. 每项给出 error（渲染器报的错）与 context（块前面的一小段正文，仅供理解这块想表达什么）
3. mermaid：只用基础语法（graph / flowchart / sequenceDiagram / timeline / mindmap），节点文字含括号、冒号、引号时用双引号包起来
4. genui：必须是合法 JSON，结构为 {"type":"steps|compare|timeline|cards|callout|tabs|quiz", ...}，不要注释和尾逗号；quiz 的 answer 是 options 的下标
5. html：只写片段（不要 <html> / <head>），不引用任何外链资源，不用 iframe / form / meta / link
6. 实在修不好、或本来内容就不完整无法补全：该项 code 写 null（会被删除，不影响正文）
7. 不要输出围栏，code 里就是块的源码本身

## 输出要求
**只输出一个 JSON 对象**，不要解释：{"fixes":[{"id":0,"code":"修好的源码或 null"}]}，id 与输入一一对应

## 待修复的块（JSON）
{{blocks}}
