/**
 * 关键图表结构化抽取 Prompt
 * 输出纯 JSON，供 parseCharts + zod 校验
 */

export function getKeyChartsPrompt(): string {
  return `你是书籍结构化分析助手。根据提供的章节摘要、章节关联与全书总结，抽取**可视化用**的关键图表数据。

## 输出要求
- **只输出一个 JSON 对象**，不要 Markdown 解释、不要代码围栏外的文字
- 结构必须符合：
{
  "version": 1,
  "personGraph": {
    "nodes": [
      { "id": "p1", "name": "人名", "type": "人物", "description": "一句话身份/作用", "importance": 8 }
    ],
    "edges": [
      { "source": "p1", "target": "p2", "relation": "师生", "description": "关系简述" }
    ]
  },
  "entityTimeline": {
    "entities": [
      { "id": "p1", "name": "人名", "type": "人物" }
    ],
    "events": [
      {
        "id": "e1",
        "label": "事件短标题（≤12字）",
        "timeLabel": "童年/1985/第3章",
        "order": 1,
        "entityIds": ["p1"],
        "description": "事件简述",
        "chapterHint": "可选章节提示"
      }
    ]
  }
}

## 规则
1. 只依据给定摘要抽取，**禁止编造**与材料矛盾的事实；不确定则省略
2. **人物节点**：核心人物为主；合并别名到同一 id；importance 1–10
   - 主角/联合创始人等 ≥8；关键家人/挚友/导师 6–8；一笔带过的配角 ≤5 且总数从严
   - 优先 nodes≤25：宁缺毋滥，避免星形全连到主角的弱边
3. **关系边** relation 用短中文（家人/师生/对手/合作/合伙人/上下级/挚友等）；description 一句内
4. **时间线实体**（≤10）：核心人物 + 必要时的组织/产品/关键事物（如公司、电脑型号）
5. **事件** 按叙事时间 order 递增；timeLabel 用可读标签（年龄段/年份/章节），不要强制 ISO
   - 优先 12–25 个里程碑：天赋觉醒、关键相遇、产品/事业节点、转折与损失、创业成立等
   - label 极短；多实体事件在 entityIds 列出主要参与者
6. personGraph 与 entityTimeline 的人物 **id 必须一致**
7. 数量硬上限：nodes≤40、edges≤80、entities≤12、events≤50
8. 传记/回忆录优先：人物弧线、伙伴与对手、事业节点；社科书可把「学派/机构」当实体
9. 若某类信息不足可省略对应字段，但至少提供一类有意义的数据`
}
