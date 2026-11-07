# config-step Specification

## Purpose

约束「配置」步骤（`ConfigStep`）的入口收敛：书库入口只由顶部三阶段导航提供，配置步内部不再重复放置返回按钮。

## ADDED Requirements

### Requirement: 书库入口唯一

配置步 SHALL NOT 在内容区再渲染一个「返回书库」入口；回到书库只经顶部三阶段导航「书库 / 设置 / 处理」。

#### Scenario: 处理段不再显示返回按钮
- **GIVEN** WebDAV 已启用，配置步停在与「设置」段对应的处理视图
- **WHEN** 渲染配置步
- **THEN** 内容区不出现「返回书库」按钮
- **AND** 顶部导航仍显示「书库」并可在书库视图间切换
